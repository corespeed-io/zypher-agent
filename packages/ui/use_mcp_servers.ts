import type {
  McpClientStatus,
  McpServerEndpoint,
  McpServerSource,
} from "@zypher/types";
import type { McpWebSocketEvent } from "@zypher/types";
import { retry, scan, timer } from "rxjs";
import { webSocket } from "rxjs/webSocket";
import useSWRSubscription from "swr/subscription";
import { toWebSocketUrl } from "./utils.ts";

// WebSocket protocol version
const MCP_WEBSOCKET_PROTOCOL = "zypher.mcp.v1";

/** Represents the current state of an MCP server, including its connection status and configuration. */
export interface McpServerState {
  /** Unique identifier for this MCP server. */
  serverId: string;
  /** Server endpoint configuration (transport, URL, etc.). */
  server: McpServerEndpoint;
  /** Where this server was discovered from (registry or direct config). */
  source: McpServerSource;
  /** Current connection status of the MCP client. */
  status: McpClientStatus;
  /** Whether this server is enabled for use. */
  enabled: boolean;
  /** OAuth authorization URL when the server is awaiting OAuth approval. */
  pendingOAuthUrl?: string;
}

/** Dot-notation patterns for matching MCP client status states and sub-states. */
export type McpClientStatusPattern =
  | "disconnected"
  | "connecting"
  | "connecting.initializing"
  | "connecting.awaitingOAuth"
  | "connected"
  | "connected.initial"
  | "connected.toolDiscovered"
  | "disconnecting"
  | "disconnectingDueToError"
  | "error"
  | "aborting"
  | "disposed";
/**
 * Helper function to match MCP client status patterns (similar to XState's matches).
 *
 * @example
 * // Match exact string status
 * matchStatus(status, "disconnected") // true if status === "disconnected"
 *
 * // Match parent state (any connecting sub-state)
 * matchStatus(status, "connecting") // true if status is { connecting: "initializing" } or { connecting: "awaitingOAuth" }
 *
 * // Match specific sub-state
 * matchStatus(status, "connecting.awaitingOAuth") // true only if status is { connecting: "awaitingOAuth" }
 * matchStatus(status, "connected.toolDiscovered") // true only if status is { connected: "toolDiscovered" }
 */
export function matchStatus(
  status: McpClientStatus,
  pattern: McpClientStatusPattern,
): boolean {
  // Handle dot notation for nested states
  if (pattern.includes(".")) {
    const [parent, child] = pattern.split(".");
    if (typeof status === "object" && parent in status) {
      return (status as Record<string, string>)[parent] === child;
    }
    return false;
  }

  // Handle string statuses
  if (typeof status === "string") {
    return status === pattern;
  }

  // Handle object statuses - match parent state
  if (typeof status === "object") {
    return pattern in status;
  }

  return false;
}

/**
 * WebSocket connection status for MCP servers.
 * - `idle`: Connection is disabled (enabled=false)
 * - `connecting`: Attempting to establish WebSocket connection
 * - `connected`: Successfully connected and received initial state
 * - `error`: Connection failed after all retry attempts
 */
export type McpConnectionStatus = "idle" | "connecting" | "connected" | "error";

/** Return value of the {@link useMcpServers} hook. */
export interface UseMcpServersReturn {
  /** Map of server ID to its current state. */
  servers: Record<string, McpServerState>;
  /** Whether the initial state has been received from the WebSocket. */
  isLoading: boolean;
  /** WebSocket connection status. */
  status: McpConnectionStatus;
  /** WebSocket connection error, if any. */
  error: unknown;
}

/** Options for the {@link useMcpServers} hook. */
export interface UseMcpServersOptions {
  /**
   * Base URL of the API server (e.g. `ws://localhost:3000`).
   * `http://`/`https://` URLs are automatically converted to `ws://`/`wss://`.
   */
  apiBaseUrl: string;
  /** Whether to connect to the WebSocket. @default true */
  enabled?: boolean;
  /**
   * WebSocket sub-protocols. Static array or function (sync or async).
   * @default ["zypher.mcp.v1"]
   */
  protocols?: string[] | (() => string[] | Promise<string[]>);
}

/** Reducer to accumulate MCP server state from WebSocket events. */
function reduceEvent(
  state: Record<string, McpServerState>,
  event: McpWebSocketEvent,
): Record<string, McpServerState> {
  switch (event.type) {
    case "initial_state": {
      const serverRecord: Record<string, McpServerState> = {};
      for (const server of event.servers) {
        serverRecord[server.serverId] = server;
      }
      return serverRecord;
    }

    case "server_added":
      return {
        ...state,
        [event.serverId]: {
          serverId: event.serverId,
          server: event.server,
          source: event.source,
          status: "disconnected",
          enabled: false,
        },
      };

    case "server_updated": {
      const existing = state[event.serverId];
      if (!existing) return state;

      return {
        ...state,
        [event.serverId]: {
          ...existing,
          ...(event.updates.server && { server: event.updates.server }),
          ...(event.updates.enabled !== undefined && {
            enabled: event.updates.enabled,
          }),
        },
      };
    }

    case "server_removed": {
      const { [event.serverId]: _, ...rest } = state;
      return rest;
    }

    case "client_status_changed": {
      const existing = state[event.serverId];
      if (!existing) return state;

      // Only keep pendingOAuthUrl if status is awaitingOAuth
      const isAwaitingOAuth = matchStatus(
        event.status,
        "connecting.awaitingOAuth",
      );

      return {
        ...state,
        [event.serverId]: {
          ...existing,
          status: event.status,
          pendingOAuthUrl: isAwaitingOAuth ? event.pendingOAuthUrl : undefined,
        },
      };
    }

    case "error":
      // Error events don't change state
      return state;
  }
}

/** Resolve protocols option to a string array. */
async function resolveProtocols(
  protocols: UseMcpServersOptions["protocols"],
): Promise<string[]> {
  if (!protocols) return [MCP_WEBSOCKET_PROTOCOL];
  return typeof protocols === "function" ? await protocols() : protocols;
}

/**
 * Hook that maintains a WebSocket connection to the MCP server state stream.
 * Automatically reconnects on disconnect and keeps server state in sync.
 * Uses SWR subscription to deduplicate connections across components.
 */
export function useMcpServers(
  { apiBaseUrl, enabled = true, protocols }: UseMcpServersOptions,
): UseMcpServersReturn {
  const { data, error } = useSWRSubscription(
    enabled ? ["mcp-servers", apiBaseUrl] : null,
    ([, url], { next }) => {
      const wsUrl = toWebSocketUrl(`${url}/mcp/ws`);
      const abortController = new AbortController();
      let subscription: { unsubscribe(): void } | undefined;

      // Resolve protocols (may be async) then connect
      resolveProtocols(protocols)
        .then((resolvedProtocols) => {
          // Don't start subscription if already cleaned up
          if (abortController.signal.aborted) return;

          const ws$ = webSocket<McpWebSocketEvent>({
            url: wsUrl,
            protocol: resolvedProtocols,
          });

          subscription = ws$
            .pipe(
              retry({
                count: 10,
                delay: (_err, retryCount) => {
                  const backoff = Math.min(1000 * 2 ** retryCount, 30000);
                  console.log(
                    `[MCP WebSocket] Connection failed, retrying in ${backoff}ms... (attempt ${retryCount}/10)`,
                  );
                  return timer(backoff);
                },
                resetOnSuccess: true,
              }),
              scan(reduceEvent, {}),
            )
            .subscribe({
              next: (state) => next(null, state),
              error: (err) => next(err),
            });
        })
        .catch((err) => {
          if (!abortController.signal.aborted) next(err);
        });

      return () => {
        abortController.abort();
        subscription?.unsubscribe();
      };
    },
  );

  // Derive connection status from state
  const status: McpConnectionStatus = !enabled
    ? "idle"
    : error
    ? "error"
    : data === undefined
    ? "connecting"
    : "connected";

  return {
    servers: data ?? {},
    isLoading: data === undefined,
    status,
    error,
  };
}
