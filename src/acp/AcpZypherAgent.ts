/**
 * ACP Zypher Agent
 *
 * A simple adapter that wraps ZypherAgent and implements the acp.Agent interface.
 * This allows ZypherAgent to be used as an ACP-compatible agent with clients like Zed.
 */

import type * as acp from "acp";
import type { ModelProvider } from "../llm/mod.ts";
import type { Tool } from "../tools/mod.ts";
import type { McpServerEndpoint } from "../mcp/mod.ts";
import { ZypherAgent, type ZypherAgentOptions } from "../ZypherAgent.ts";
import { createZypherContext } from "../utils/context.ts";
import type { TaskEvent } from "../TaskEvents.ts";
import type { ToolResultBlock } from "../message.ts";

/**
 * Session state for an ACP session
 */
interface AcpSession {
  agent: ZypherAgent;
  cwd: string;
  abortController: AbortController | null;
  toolCallIds: Map<string, string>;
}

/**
 * Options for creating an AcpZypherAgent
 */
export interface AcpZypherAgentOptions {
  /** The AI model provider (Anthropic or OpenAI) */
  modelProvider: ModelProvider;
  /** Default model to use for tasks */
  defaultModel?: string;
  /** Tools available to the agent */
  tools?: Tool[];
  /** MCP servers to register */
  mcpServers?: (string | McpServerEndpoint)[];
  /** Additional agent options */
  agentOptions?: Partial<ZypherAgentOptions>;
}

/**
 * AcpZypherAgent implements the acp.Agent interface, bridging
 * ZypherAgent's task execution to the ACP protocol.
 */
export class AcpZypherAgent implements acp.Agent {
  readonly #connection: acp.AgentSideConnection;
  readonly #options: AcpZypherAgentOptions;
  readonly #sessions = new Map<string, AcpSession>();
  readonly #defaultModel: string;

  constructor(
    connection: acp.AgentSideConnection,
    options: AcpZypherAgentOptions,
  ) {
    this.#connection = connection;
    this.#options = options;
    this.#defaultModel = options.defaultModel ?? "claude-sonnet-4-20250514";
  }

  // deno-lint-ignore require-await
  async initialize(
    _params: acp.InitializeRequest,
  ): Promise<acp.InitializeResponse> {
    return {
      protocolVersion: 1,
      agentInfo: {
        name: "zypher-agent",
        version: "0.1.0",
      },
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {
          image: true,
        },
      },
    };
  }

  async newSession(
    params: acp.NewSessionRequest,
  ): Promise<acp.NewSessionResponse> {
    const sessionId = crypto.randomUUID();
    const context = await createZypherContext(params.cwd);

    const agent = new ZypherAgent(context, this.#options.modelProvider, {
      tools: this.#options.tools,
      ...this.#options.agentOptions,
    });

    // Register MCP servers from options
    if (this.#options.mcpServers) {
      await Promise.all(
        this.#options.mcpServers.map((server) =>
          typeof server === "string"
            ? agent.mcp.registerServerFromRegistry(server)
            : agent.mcp.registerServer(server)
        ),
      );
    }

    // Register MCP servers from ACP client
    if (params.mcpServers?.length) {
      await this.#registerAcpMcpServers(agent, params.mcpServers);
    }

    this.#sessions.set(sessionId, {
      agent,
      cwd: params.cwd,
      abortController: null,
      toolCallIds: new Map(),
    });

    return { sessionId };
  }

  // deno-lint-ignore require-await
  async authenticate(
    _params: acp.AuthenticateRequest,
  ): Promise<acp.AuthenticateResponse | void> {
    return {};
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = this.#sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session ${params.sessionId} not found`);
    }

    session.abortController?.abort();
    session.abortController = new AbortController();

    const promptText = params.prompt
      .filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text)
      .join("\n");

    try {
      const observable = session.agent.runTask(
        promptText,
        this.#defaultModel,
        undefined,
        { signal: session.abortController.signal },
      );

      await new Promise<void>((resolve, reject) => {
        observable.subscribe({
          next: (event) => this.#handleTaskEvent(params.sessionId, event),
          error: reject,
          complete: resolve,
        });
      });

      return { stopReason: "end_turn" };
    } catch (_error) {
      if (session.abortController.signal.aborted) {
        return { stopReason: "cancelled" };
      }
      throw _error;
    } finally {
      session.abortController = null;
    }
  }

  // deno-lint-ignore require-await
  async cancel(params: acp.CancelNotification): Promise<void> {
    this.#sessions.get(params.sessionId)?.abortController?.abort();
  }

  #handleTaskEvent(sessionId: string, event: TaskEvent): void {
    const session = this.#sessions.get(sessionId);
    if (!session) return;

    switch (event.type) {
      case "text":
        this.#connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: event.content },
          },
        });
        break;

      case "tool_use": {
        const toolCallId = `call_${Date.now()}_${event.toolName}`;
        session.toolCallIds.set(event.toolName, toolCallId);
        this.#connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId,
            title: event.toolName,
            kind: this.#getToolKind(event.toolName),
            status: "in_progress",
          },
        });
        break;
      }

      case "tool_use_input": {
        const toolCallId = session.toolCallIds.get(event.toolName);
        if (toolCallId) {
          this.#connection.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId,
              rawInput: event.partialInput,
            },
          });
        }
        break;
      }

      case "message":
        if (event.message.role === "user") {
          for (const content of event.message.content) {
            if (content.type === "tool_result") {
              const toolResult = content as ToolResultBlock;
              const toolCallId = session.toolCallIds.get(toolResult.name);
              if (toolCallId) {
                this.#connection.sessionUpdate({
                  sessionId,
                  update: {
                    sessionUpdate: "tool_call_update",
                    toolCallId,
                    status: toolResult.success ? "completed" : "failed",
                    rawOutput: toolResult.content,
                  },
                });
                session.toolCallIds.delete(toolResult.name);
              }
            }
          }
        }
        break;

      case "completed":
      case "cancelled":
      case "usage":
      case "history_changed":
        break;
    }
  }

  #getToolKind(toolName: string): acp.ToolKind {
    const name = toolName.toLowerCase();
    if (name.includes("read") || name.includes("list")) return "read";
    if (name.includes("edit") || name.includes("write")) return "edit";
    if (name.includes("delete") || name.includes("remove")) return "delete";
    if (name.includes("search") || name.includes("grep") || name.includes("find")) return "search";
    if (name.includes("run") || name.includes("exec") || name.includes("terminal")) return "execute";
    return "other";
  }

  async #registerAcpMcpServers(
    agent: ZypherAgent,
    mcpServers: acp.McpServer[],
  ): Promise<void> {
    for (const server of mcpServers) {
      try {
        if ("type" in server && (server.type === "http" || server.type === "sse")) {
          const headers: Record<string, string> = {};
          for (const h of server.headers) {
            headers[h.name] = h.value;
          }
          await agent.mcp.registerServer({
            id: server.name,
            type: "remote",
            remote: { url: server.url, headers },
          });
        } else {
          const stdioServer = server as acp.McpServerStdio;
          const env: Record<string, string> = {};
          for (const e of stdioServer.env) {
            env[e.name] = e.value;
          }
          await agent.mcp.registerServer({
            id: stdioServer.name,
            type: "command",
            command: {
              command: stdioServer.command,
              args: stdioServer.args,
              env,
            },
          });
        }
      } catch (error) {
        console.error(`[ACP] Failed to register MCP server "${server.name}":`, error);
      }
    }
  }
}
