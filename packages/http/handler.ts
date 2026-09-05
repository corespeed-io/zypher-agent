import { Hono } from "hono";
import { upgradeWebSocket } from "hono/deno";
import {
  type McpWebSocketEvent,
  sendTaskWebSocketMessage,
  TaskWebSocketClientMessage,
  toMcpWebSocketEvent,
} from "./schema.ts";
import {
  type ErrorEvent,
  type HttpTaskEvent,
  HttpTaskEventId,
  replayHttpTaskEvents,
  withHttpTaskEventReplayAndHeartbeat,
} from "./task_event.ts";
import {
  catchError,
  EMPTY,
  filter,
  map,
  type Observable,
  of,
  type ReplaySubject,
  startWith,
  type Subscription,
} from "rxjs";
import type { ZypherAgent } from "@zypher/agent";
import { type Completer, formatError } from "@zypher/utils";

/**
 * Context provided to the error callback.
 */
export interface ErrorContext {
  /** The endpoint where the error occurred (e.g., "/task/ws", "/mcp/ws") */
  endpoint: string;
}

/**
 * Error callback return type.
 * - Return an object to send custom error data to the client
 * - Return void to handle the error silently
 * - Throw to propagate the error
 */
export type ErrorResponse = Record<string, unknown> | void;

/**
 * WebSocket-specific options.
 *
 * WebSocket connections don't support middleware, so these options provide
 * error handling capabilities for WebSocket endpoints.
 */
export interface WebSocketOptions {
  /**
   * Error callback for graceful error handling.
   *
   * Allows server-side logging and control over what error information is
   * sent to clients.
   *
   * @param error - The error that occurred
   * @param context - Context about where the error occurred
   * @returns
   *   - Return an object to send custom error data to the client
   *   - Return void to handle the error silently
   *   - Throw to propagate the error
   *
   * @example
   * ```ts
   * onError: (error, ctx) => {
   *   console.error(`[${ctx.endpoint}]`, error);
   *
   *   if ((error as any)?.status === 402) {
   *     return { status: 402, code: "payment_required" };
   *   }
   *   if (isExpectedError(error)) {
   *     return;
   *   }
   *   throw error;
   * }
   * ```
   */
  onError?: (error: unknown, context: ErrorContext) => ErrorResponse;
  /**
   * Send unhandled error details to clients before closing WebSocket.
   *
   * When enabled, errors that propagate (not handled by `onError`) will send
   * name, message, and stack trace to the client.
   *
   * WARNING: May leak sensitive information (API keys, internal paths, etc.).
   * Only enable in development or trusted environments.
   *
   * @default false
   */
  exposeErrors?: boolean;
}

/**
 * Options for creating a Zypher HTTP handler.
 */
export interface ZypherHandlerOptions {
  /** The Zypher agent instance to expose via HTTP/WebSocket. */
  agent: ZypherAgent;
  /** Options for WebSocket endpoints. */
  websocket?: WebSocketOptions;
}

/**
 * Converts an unknown error to an HttpTaskEvent for client transmission.
 */
function toErrorEvent(error: unknown): HttpTaskEvent {
  const eventId = HttpTaskEventId.generate();
  if (error instanceof Error) {
    return {
      type: "error",
      name: error.name,
      message: error.message,
      stack: error.stack,
      eventId,
    };
  }
  return {
    type: "error",
    name: "Error",
    message: String(error),
    eventId,
  };
}

/**
 * Creates a Hono app that handles Zypher agent requests.
 * The returned app can be used as a fetch handler or mounted in another Hono app.
 */
export function createZypherHandler(options: ZypherHandlerOptions): Hono {
  const app = new Hono();
  const { agent, websocket } = options;
  const { exposeErrors = false, onError } = websocket ?? {};

  let taskAbortController: AbortController | null = null;
  let taskEventSubject: ReplaySubject<HttpTaskEvent> | null = null;
  let toolApprovalCompletor: Completer<boolean> | null = null;
  let serverLatestEventId: HttpTaskEventId | undefined;

  app
    // Health check
    .get("/health", (c) => c.json({ status: "ok" }))
    // Get agent messages
    .get("/messages", (c) => {
      return c.json(agent.messages);
    })
    // Clear agent messages
    .delete("/messages", (c) => {
      agent.clearMessages();
      return c.body(null, 204);
    })
    /**
     * GET /task/ws - WebSocket endpoint for agent task execution.
     *
     * Protocol: zypher.v1
     *
     * Client → Server: {@link TaskWebSocketClientMessage}
     * - startTask: Start a new task with { task, fileAttachments? }
     * - resumeTask: Reconnect to running task with { lastEventId? }
     * - cancelTask: Cancel the running task
     * - approveTool: Respond to tool approval with { approved }
     *
     * Server → Client: {@link HttpTaskEvent} | {@link TaskWebSocketServerMessage}
     * - HttpTaskEvent: Streaming task events (text, tool_use, message, usage, etc.)
     * - TaskWebSocketServerMessage: Control messages (error, completed)
     */
    .get(
      "/task/ws",
      upgradeWebSocket(
        () => {
          let firstMessageTimeoutId: ReturnType<typeof setTimeout>;
          let firstMessageReceived = false;

          return {
            onOpen: (_, ws) => {
              // Set timeout to close connection if no message is received within 6 seconds
              firstMessageTimeoutId = setTimeout(() => {
                if (!firstMessageReceived) {
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.close(1008, "no_message_received");
                  }
                }
              }, 6000); // 6 seconds timeout
            },
            onMessage(event, ws) {
              if (!firstMessageReceived) {
                firstMessageReceived = true;
                clearTimeout(firstMessageTimeoutId); // Clear timeout as the first message has been received
              }

              let rawMessage: unknown;
              try {
                rawMessage = JSON.parse(event.data.toString());
              } catch (error) {
                if (error instanceof SyntaxError) {
                  ws.close(1003, "invalid_message");
                  return;
                }
                throw error;
              }

              const { success, data: message } = TaskWebSocketClientMessage
                .safeParse(rawMessage);

              if (!success) {
                ws.close(1003, "invalid_message");
                return;
              }
              switch (message.action) {
                case "startTask": {
                  // Check if a task is already running
                  if (taskAbortController || taskEventSubject) {
                    ws.close(1008, "task_already_in_progress");
                    return;
                  }

                  // Create abort controller and start task
                  const abortController = taskAbortController ??=
                    new AbortController();

                  const eventSubject = taskEventSubject ??= runAgentTask(
                    agent,
                    message.task,
                    { signal: abortController.signal },
                  );

                  // Track last event to determine close code
                  let lastEvent: HttpTaskEvent | undefined;

                  // Subscribe to events and send them over WebSocket
                  eventSubject
                    .pipe(
                      catchError((err) => {
                        if (!onError) throw err;
                        const result = onError(err, { endpoint: "/task/ws" });
                        if (result == undefined) return EMPTY;
                        return of<HttpTaskEvent>(
                          {
                            ...result,
                            type: "error",
                            eventId: HttpTaskEventId.generate(),
                          } satisfies ErrorEvent,
                        );
                      }),
                    )
                    .subscribe({
                      next: (taskEvent) => {
                        lastEvent = taskEvent;
                        serverLatestEventId = taskEvent.eventId;
                        sendTaskWebSocketMessage(ws, taskEvent);
                      },
                      error: (err) => {
                        if (exposeErrors) {
                          sendTaskWebSocketMessage(ws, toErrorEvent(err));
                        }
                        ws.close(1011, "internal_error");
                        taskEventSubject = null;
                        taskAbortController = null;
                      },
                      complete: () => {
                        const isComplete = lastEvent?.type === "completed";
                        ws.close(
                          isComplete ? 1000 : 4000,
                          isComplete ? "task_completed" : "task_failed",
                        );
                        taskEventSubject = null;
                        taskAbortController = null;
                      },
                    });
                  break;
                }

                case "resumeTask": {
                  // Check if a task is running
                  if (!taskEventSubject || !taskAbortController) {
                    ws.close(1008, "task_not_running");
                    return;
                  }

                  // Parse client's lastEventId if provided
                  const clientLastEventId = message.lastEventId
                    ? HttpTaskEventId.safeParse(message.lastEventId)
                    : undefined;

                  // Replay events from the task event subject
                  const events$ = replayHttpTaskEvents(
                    taskEventSubject,
                    serverLatestEventId,
                    clientLastEventId ?? undefined,
                  );

                  // Track last event to determine close code
                  let lastEvent: HttpTaskEvent | undefined;

                  // Subscribe to replayed events and send them over WebSocket
                  events$
                    .pipe(
                      catchError((err) => {
                        if (!onError) throw err;
                        const result = onError(err, { endpoint: "/task/ws" });
                        if (result == undefined) return EMPTY;
                        return of<HttpTaskEvent>(
                          {
                            ...result,
                            type: "error",
                            eventId: HttpTaskEventId.generate(),
                          } satisfies ErrorEvent,
                        );
                      }),
                    )
                    .subscribe({
                      next: (taskEvent) => {
                        lastEvent = taskEvent;
                        sendTaskWebSocketMessage(ws, taskEvent);
                      },
                      error: (err) => {
                        if (exposeErrors) {
                          sendTaskWebSocketMessage(ws, toErrorEvent(err));
                        }
                        ws.close(1011, "internal_error");
                        // Note: Don't clean up taskEventSubject here since the original
                        // subscription is still active. Only the startTask handler should clean up.
                      },
                      complete: () => {
                        const isComplete = lastEvent?.type === "completed";
                        ws.close(
                          isComplete ? 1000 : 4000,
                          isComplete ? "task_completed" : "task_failed",
                        );
                      },
                    });
                  break;
                }

                case "cancelTask": {
                  // Check if a task is running
                  if (!agent.isTaskRunning) {
                    ws.close(1008, "task_not_running");
                    return;
                  }

                  if (!taskAbortController || !taskEventSubject) {
                    if (exposeErrors) {
                      sendTaskWebSocketMessage(
                        ws,
                        toErrorEvent(new Error("Invalid task state")),
                      );
                    }
                    ws.close(1011, "internal_error");
                    return;
                  }

                  if (!taskAbortController.signal.aborted) {
                    taskAbortController.abort();
                  }

                  break;
                }

                case "approveTool": {
                  if (!toolApprovalCompletor) {
                    ws.close(1008, "no_tool_approval_pending");
                    return;
                  }

                  toolApprovalCompletor.resolve(message.approved);
                  toolApprovalCompletor = null;
                  break;
                }
              }
            },
            onClose: () => {
              // Clean up timeout if the connection was closed before the first message was received
              clearTimeout(firstMessageTimeoutId);
              // Task continues running - abort only via explicit cancelTask or timeout
            },
          };
        },
        { protocol: "zypher.v1" },
      ),
    )
    /**
     * GET /mcp/ws - WebSocket endpoint for real-time MCP server state updates.
     *
     * Establishes a WebSocket connection that streams MCP server events.
     * Uses the zypher.mcp.v1 protocol.
     *
     * Events are discriminated unions with a `type` field:
     *
     * 1. **initialState**: Sent immediately on connection with current server state
     *    - servers: Array of { serverId, server, source, status, enabled, pendingOAuthUrl? }
     *
     * 2. **serverAdded**: Emitted when a server is registered
     *    - serverId: unique server identifier
     *    - server: McpServerEndpoint configuration
     *    - source: { type: "registry" | "direct", packageIdentifier?: string }
     *
     * 3. **serverUpdated**: Emitted when server configuration changes
     *    - serverId: unique server identifier
     *    - updates: { server?: McpServerEndpoint, enabled?: boolean }
     *
     * 4. **serverRemoved**: Emitted when a server is deregistered
     *    - serverId: unique server identifier
     *
     * 5. **clientStatusChanged**: Emitted when client connection status changes
     *    - serverId: unique server identifier
     *    - status: McpClientStatus ("disconnected" | "connecting" | "connected" | "error" | etc.)
     *    - pendingOAuthUrl?: string (present when status is { connecting: "awaitingOAuth" })
     *
     * @returns WebSocket connection that streams MCP server events
     */
    .get(
      "/mcp/ws",
      upgradeWebSocket(
        () => {
          let stateSubscription: Subscription | null = null;

          return {
            /**
             * Handles WebSocket connection open event.
             *
             * Subscribes to the MCP server events stream and forwards events to the client.
             * Automatically sends status updates for all registered servers.
             */
            onOpen: (_, ws) => {
              // Build initial state from current servers
              const initialState: McpWebSocketEvent = {
                type: "initial_state",
                servers: Array.from(agent.mcp.servers.entries()).map((
                  [serverId, info],
                ) => ({
                  serverId,
                  server: info.server,
                  source: info.source,
                  status: info.client.status,
                  enabled: info.client.desiredEnabled,
                  pendingOAuthUrl: info.client.pendingOAuthUrl,
                })),
              };

              stateSubscription = agent.mcp.events$
                .pipe(
                  map(toMcpWebSocketEvent),
                  filter((event) => !!event),
                  startWith(initialState),
                  catchError((err) => {
                    if (!onError) throw err;
                    const result = onError(err, { endpoint: "/mcp/ws" });
                    if (result == undefined) return EMPTY;
                    return of(
                      {
                        ...result,
                        type: "error",
                      } satisfies McpWebSocketEvent,
                    );
                  }),
                )
                .subscribe({
                  next: (event) => {
                    ws.send(JSON.stringify(event));
                  },
                  error: (err) => {
                    if (exposeErrors) {
                      const mcpError: McpWebSocketEvent = {
                        type: "error",
                        error: formatError(err),
                      };
                      ws.send(JSON.stringify(mcpError));
                    }
                    ws.close(1011, "internal_error");
                  },
                });
            },
            /**
             * Handles WebSocket connection close event.
             *
             * Cleans up the event stream subscription when the client disconnects.
             * This is called after onError if an error occurs, so no separate error handler is needed.
             */
            onClose: () => {
              stateSubscription?.unsubscribe();
            },
          };
        },
        { protocol: "zypher.mcp.v1" },
      ),
    );

  return app;
}

function runAgentTask(
  agent: ZypherAgent,
  taskPrompt: string,
  options?: { signal?: AbortSignal },
): ReplaySubject<HttpTaskEvent> {
  const zypherHttpTaskEvent$ = agent.runTask(
    taskPrompt,
    undefined,
    options,
  );

  // Track whether we've seen the first message event
  let firstUserMessageEventSeen = false;

  const agentHttpTaskEvent$: Observable<HttpTaskEvent> = zypherHttpTaskEvent$
    .pipe(
      filter((event) => {
        // Filter out the first user message event since the client optimistically updates
        if (!firstUserMessageEventSeen && event.type === "message") {
          if (event.message.role === "user") {
            firstUserMessageEventSeen = true;
            return false; // Skip this event
          }
        }
        return true;
      }),
      map((event): HttpTaskEvent => {
        // Add eventId to the Zypher event
        const eventId = HttpTaskEventId.generate();
        return {
          ...event,
          eventId,
        };
      }),
    );

  // 30 seconds heartbeat
  return withHttpTaskEventReplayAndHeartbeat(agentHttpTaskEvent$, 30000);
}
