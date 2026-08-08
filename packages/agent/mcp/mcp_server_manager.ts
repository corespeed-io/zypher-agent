import { McpClient, type McpClientStatus } from "./mcp_client.ts";
import type { Tool, ToolResult } from "../tools/mod.ts";
import type { McpServerEndpoint } from "./mod.ts";
import type { ZypherContext } from "../zypher_agent.ts";
import type { OAuthOptions } from "./connect.ts";
import McpStoreClient from "@corespeed/mcp-store-client";
import { convertServerDetailToEndpoint } from "./utils.ts";
import { type Observable, Subject, type Subscription } from "rxjs";
import { isAbortError } from "@zypher/utils";

// Re-export shared type from @zypher/types
export type { McpServerSource } from "@zypher/types";
import type { McpServerSource } from "@zypher/types";

/**
 * Represents the internal state of an MCP server including its configuration,
 * client connection, source information, and status subscription.
 */
interface McpServerState {
  /** The server configuration */
  server: McpServerEndpoint;
  /** Metadata about the source of this server */
  source: McpServerSource;
  /** The MCP client instance for this server */
  client: McpClient;
  /** Subscription to client status changes */
  subscription: Subscription;
}

/**
 * Public server info containing the live McpClient instance
 * and readonly snapshots of server configuration and source metadata.
 */
export type McpServerInfo = Omit<McpServerState, "subscription">;

/**
 * Discriminated union of all MCP server manager events
 */
export type McpServerManagerEvent =
  | {
    type: "server_added";
    serverId: string;
    server: McpServerEndpoint;
    source: McpServerSource;
  }
  | {
    type: "server_updated";
    serverId: string;
    updates: { server?: McpServerEndpoint; enabled?: boolean };
  }
  | {
    type: "server_removed";
    serverId: string;
  }
  | {
    type: "client_status_changed";
    serverId: string;
    status: McpClientStatus;
    client: McpClient;
  }
  | {
    type: "tool_use_pending_approval";
    toolUseId: string;
    toolName: string;
    input: unknown;
  }
  | {
    type: "tool_use_approved";
    toolUseId: string;
    toolName: string;
  }
  | {
    type: "tool_use_rejected";
    toolUseId: string;
    toolName: string;
    input: unknown;
    reason: string;
  }
  | {
    type: "tool_use_result";
    toolUseId: string;
    toolName: string;
    input: unknown;
    result: ToolResult;
  }
  | {
    type: "tool_use_error";
    toolUseId: string;
    toolName: string;
    input: unknown;
    error: unknown;
  }
  | {
    type: "tool_use_cancelled";
    toolUseId: string;
    toolName: string;
    input: unknown;
  };

/**
 * Handler function for tool approval requests.
 * Called before each tool execution to determine if the tool should be allowed to run.
 *
 * @param name - The name of the tool being invoked
 * @param input - The input parameters passed to the tool
 * @param options - Optional settings including an AbortSignal for cancellation
 * @returns Promise resolving to true if the tool is approved, false to reject
 *
 * @example
 * ```typescript
 * const handler: ToolApprovalHandler = async (name, input) => {
 *   console.log(`Tool ${name} requested with input:`, input);
 *   // Prompt user for approval or apply custom logic
 *   return true; // or false to reject
 * };
 * ```
 */
export type ToolApprovalHandler = (
  name: string,
  input: unknown,
  options?: { signal?: AbortSignal },
) => Promise<boolean>;

/**
 * Configuration options for McpServerManager.
 */
export interface McpServerManagerOptions {
  /**
   * Optional handler called before each tool execution for approval.
   * If not provided, all tools are automatically approved.
   */
  toolApprovalHandler?: ToolApprovalHandler;
  /**
   * Optional MCP Store registry client for discovering and registering servers.
   * Defaults to the CoreSpeed MCP Store.
   */
  registryClient?: McpStoreClient;
}

/**
 * McpServerManager is a class that manages MCP (Model Context Protocol) servers and their tools.
 * It handles server registration, tool management, and configuration persistence.
 *
 * Authentication is handled by the McpClient layer.
 */
export class McpServerManager {
  // Unified state map containing server config, client, and subscription
  readonly #serverStateMap = new Map<string, McpServerState>();
  // toolbox for directly registered tools (non-MCP tools)
  readonly #toolbox: Map<string, Tool> = new Map();
  // MCP Store client for discovering servers (defaults to CoreSpeed MCP Store)
  readonly #registryClient: McpStoreClient;
  // Event subject for observable event streaming
  readonly #eventsSubject = new Subject<McpServerManagerEvent>();
  readonly #toolApprovalHandler?: ToolApprovalHandler;
  // Flag to track if the manager has been disposed
  #disposed = false;

  constructor(
    readonly context: ZypherContext,
    options: McpServerManagerOptions = {},
  ) {
    // Default to CoreSpeed MCP Store if none provided.
    // Pass empty apiKey since public endpoints don't require authentication.
    this.#registryClient = options.registryClient ??
      new McpStoreClient({
        apiKey: "",
        baseURL: Deno.env.get("MCP_STORE_BASE_URL"),
      });
    this.#toolApprovalHandler = options.toolApprovalHandler;
  }

  /**
   * Observable stream of all MCP server manager events.
   *
   * Emits events in real-time as:
   * - Servers are added/updated/removed
   * - Client statuses change
   *
   * The observable completes when dispose() is called.
   *
   * @returns Observable that emits discriminated union events
   */
  get events$(): Observable<McpServerManagerEvent> {
    return this.#eventsSubject.asObservable();
  }

  /**
   * Registers a new MCP server and its tools
   * @param server Server configuration (server.id is used as the key)
   * @param enabled Whether the server is enabled
   * @param source Metadata about the source of this server
   * @param oauth Optional OAuth configuration for authenticated connections
   * @returns Promise that resolves when the server is fully connected and ready (if enabled)
   * @throws McpError if server registration fails or server already exists
   */
  async registerServer(
    server: McpServerEndpoint,
    enabled: boolean = true,
    source: McpServerSource = { type: "direct" },
    oauth?: OAuthOptions,
  ): Promise<void> {
    if (this.#disposed) {
      throw new Error("McpServerManager has been disposed");
    }
    if (this.#serverStateMap.has(server.id)) {
      throw new Error(
        `Server ${server.id} already exists`,
      );
    }

    // Validate server ID format for tool naming compatibility
    // Anthropic requires tool names to match: ^[a-zA-Z0-9_-]{1,128}$
    const VALID_SERVER_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
    if (!VALID_SERVER_ID_PATTERN.test(server.id)) {
      throw new Error(
        `Invalid server ID "${server.id}". Server IDs must only contain alphanumeric characters, underscores, and hyphens to be compatible with LLM tool naming requirements.`,
      );
    }

    // Create MCP client
    const client = new McpClient(this.context, server, { oauth });

    // Emit serverAdded event BEFORE subscribing to status changes.
    // This ensures consumers receive server_added before any client_status_changed events.
    this.#eventsSubject.next({
      type: "server_added",
      serverId: server.id,
      server,
      source,
    });

    // Subscribe to client status changes (emits initial status immediately)
    const subscription = client.status$.subscribe((status) => {
      this.#eventsSubject.next({
        type: "client_status_changed",
        serverId: server.id,
        status,
        client,
      });
    });

    // Create server state with deep copies to prevent external mutation
    const state: McpServerState = {
      server: structuredClone(server),
      source: structuredClone(source),
      client,
      subscription,
    };
    this.#serverStateMap.set(server.id, state);

    // Set enabled state
    client.desiredEnabled = enabled;

    // Wait for connection to be ready if enabled
    if (enabled) {
      await client.waitForConnection();
    }
  }

  /**
   * All currently registered MCP servers.
   *
   * Returns the McpServerInfo map which contains the live McpClient instance
   * and readonly snapshots of server configuration and source metadata.
   */
  get servers(): ReadonlyMap<string, McpServerInfo> {
    const result = new Map<string, McpServerInfo>();
    for (const [id, state] of this.#serverStateMap) {
      result.set(id, {
        server: structuredClone(state.server),
        source: structuredClone(state.source),
        client: state.client,
      });
    }
    return result;
  }

  /**
   * Lists servers from the configured registry with cursor-based pagination
   * @param options Pagination options (cursor and limit)
   * @returns Promise that resolves to a cursor page containing server details and next cursor
   */
  async listRegistryServers(options?: {
    cursor?: string;
    limit?: number;
  }): Promise<McpStoreClient.Server[]> {
    const response = await this.#registryClient.servers.list({
      cursor: options?.cursor,
      limit: options?.limit ?? 20,
    });

    return response.servers;
  }

  /**
   * Registers a server from the configured registry by package identifier
   * @param packageIdentifier The package identifier in the format "@scope/package-name" (e.g., "@modelcontextprotocol/server-filesystem")
   * @param enabled Whether the server is enabled (defaults to true)
   * @param oauth Optional OAuth configuration for authenticated connections
   * @returns Promise that resolves when the server is fully connected and ready (if enabled)
   * @throws Error if server not found in registry or registration fails
   */
  async registerServerFromRegistry(
    packageIdentifier: string,
    enabled: boolean = true,
    oauth?: OAuthOptions,
  ): Promise<void> {
    // Parse package identifier format: @scope/package-name
    const packageMatch = packageIdentifier.match(/^@([^/]+)\/(.+)$/);
    if (!packageMatch) {
      throw new Error(
        `Invalid package identifier: ${packageIdentifier}. Expected @scope/package-name format.`,
      );
    }

    const scope = packageMatch[1];
    const packageName = packageMatch[2];

    // Fetch server by scope and package name
    const response = await this.#registryClient.servers.retrieveByPackage(
      packageName,
      { scope },
    );

    const server = convertServerDetailToEndpoint(response.server);

    // Register the server
    await this.registerServer(
      server,
      enabled,
      {
        type: "registry",
        packageIdentifier,
      },
      oauth,
    );
  }

  /**
   * Deregisters a server and removes its tools
   * @param id ID of the server to deregister
   * @throws Error if server is not found or deregistration fails
   */
  async deregisterServer(id: string): Promise<void> {
    if (this.#disposed) {
      throw new Error("McpServerManager has been disposed");
    }
    const state = this.#serverStateMap.get(id);
    if (!state) {
      throw new Error(
        `Server with id ${id} not found`,
      );
    }

    // Dispose the client first (emits final status events)
    await state.client.dispose();

    // Unsubscribe from client status
    state.subscription.unsubscribe();

    // Remove server state
    this.#serverStateMap.delete(id);

    // Emit serverRemoved event
    this.#eventsSubject.next({
      type: "server_removed",
      serverId: id,
    });
  }

  /**
   * Updates server configuration and/or enabled status
   * @param serverId The ID of the server
   * @param updates Object containing server config and/or enabled status to update
   * @throws Error if server is not found or update fails
   */
  async updateServer(
    serverId: string,
    updates: {
      server?: McpServerEndpoint;
      enabled?: boolean;
    },
  ): Promise<void> {
    if (this.#disposed) {
      throw new Error("McpServerManager has been disposed");
    }
    const state = this.#serverStateMap.get(serverId);
    if (!state) {
      throw new Error(
        `Server ${serverId} not found`,
      );
    }

    const newEnabled = updates.enabled ?? state.client.desiredEnabled;

    // If config changed, re-register the server
    if (updates.server) {
      await this.deregisterServer(serverId);
      await this.registerServer(updates.server, newEnabled);
      return;
    }

    // Otherwise, just update client's desired enabled state
    state.client.desiredEnabled = newEnabled;

    // Emit serverUpdated event
    this.#eventsSubject.next({
      type: "server_updated",
      serverId,
      updates,
    });
  }

  /**
   * Registers a new tool directly (non-MCP tool)
   * @param tool The tool to register
   */
  registerTool(tool: Tool): void {
    if (this.#disposed) {
      throw new Error("McpServerManager has been disposed");
    }
    if (this.#toolbox.has(tool.name)) {
      throw new Error(
        `Tool ${tool.name} already registered`,
      );
    }

    this.#toolbox.set(tool.name, tool);
  }

  /**
   * Disposes the manager by disconnecting all servers and completing the event stream.
   * The manager cannot be reused after calling this method.
   */
  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;

    // Dispose all server clients first (emits final status events)
    await Promise.allSettled(
      Array.from(this.#serverStateMap.values()).map((state) =>
        state.client.dispose()
      ),
    );

    // Unsubscribe from all client status observables
    for (const state of this.#serverStateMap.values()) {
      state.subscription.unsubscribe();
    }
    this.#serverStateMap.clear();
    this.#toolbox.clear();

    // Complete the event stream
    this.#eventsSubject.complete();
  }

  /**
   * All registered tools from all enabled servers and directly registered tools
   * @returns Map of tool names to tool instances
   */
  get tools(): Map<string, Tool> {
    const allTools = new Map<string, Tool>();

    // Add tools from enabled MCP servers first
    for (const [_serverId, state] of this.#serverStateMap.entries()) {
      if (state.client.desiredEnabled) {
        for (const tool of state.client.tools) {
          allTools.set(tool.name, tool);
        }
      }
    }

    // Add directly registered (built-in) tools last - they take precedence in case of conflicts
    for (const [name, tool] of this.#toolbox) {
      allTools.set(name, tool);
    }

    return allTools;
  }

  /**
   * Gets a specific tool by name from directly registered tools or any enabled server
   * @param name The name of the tool to retrieve
   * @returns The tool if found, undefined otherwise
   */
  getTool(name: string): Tool | undefined {
    // Check directly registered (built-in) tools first - they take precedence
    const builtInTool = this.#toolbox.get(name);
    if (builtInTool) {
      return builtInTool;
    }

    // Then check MCP servers
    for (const [_serverId, state] of this.#serverStateMap.entries()) {
      if (state.client.desiredEnabled) {
        const tool = state.client.getTool(name);
        if (tool) {
          return tool;
        }
      }
    }

    return undefined;
  }

  /**
   * Executes a tool by name with the given input.
   *
   * @param toolUseId - Unique identifier for this tool invocation (used for event tracking).
   *   Must be unique across calls. Recommended: for direct tool calling, pass the tool_use_id
   *   from the LLM response as-is; for programmatic tool calling (PTC), use a "ptc_" prefix with a UUID.
   * @param name - The name of the tool to execute
   * @param input - The input parameters to pass to the tool
   * @param options - Optional settings including an AbortSignal for cancellation
   * @returns Promise resolving to the tool execution result
   * @throws Error if tool is not found or if rejected by the approval handler
   */
  async callTool(
    toolUseId: string,
    name: string,
    input: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<ToolResult> {
    const tool = this.getTool(name);
    if (!tool) {
      throw new Error(`Tool '${name}' not found`);
    }

    if (this.#toolApprovalHandler) {
      this.#eventsSubject.next({
        type: "tool_use_pending_approval",
        toolUseId,
        toolName: name,
        input,
      });
      const approved = await this.#toolApprovalHandler(
        name,
        input,
        options,
      );

      if (!approved) {
        const reason = "Rejected by user";
        this.#eventsSubject.next({
          type: "tool_use_rejected",
          toolUseId,
          toolName: name,
          input,
          reason,
        });
        throw new Error(`Tool call ${name} rejected by user`);
      }
    }

    // auto approve if no approval handler is provided
    this.#eventsSubject.next({
      type: "tool_use_approved",
      toolUseId,
      toolName: name,
    });

    // Early exit if already aborted before starting execution
    options?.signal?.throwIfAborted();

    try {
      const result = await tool.execute(
        input as Record<string, unknown>,
        this.context,
        { signal: options?.signal },
      );

      this.#eventsSubject.next({
        type: "tool_use_result",
        toolUseId,
        toolName: name,
        input,
        result,
      });

      return result;
    } catch (error) {
      if (isAbortError(error)) {
        this.#eventsSubject.next({
          type: "tool_use_cancelled",
          toolUseId,
          toolName: name,
          input,
        });
      } else {
        this.#eventsSubject.next({
          type: "tool_use_error",
          toolUseId,
          toolName: name,
          input,
          error,
        });
      }

      throw error;
    }
  }
}
