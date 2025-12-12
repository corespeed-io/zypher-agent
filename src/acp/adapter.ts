/**
 * ACP Protocol Adapter
 *
 * Implements the acp.Agent interface, bridging ZypherAgent's task execution
 * to the ACP protocol.
 */

import type * as acp from "acp";
import type { ZypherAgent } from "../ZypherAgent.ts";
import type { TaskEvent } from "../TaskEvents.ts";
import type { ToolResultBlock } from "../message.ts";
import type { ToolApprovalHandler } from "../loopInterceptors/mod.ts";
import { convertPromptContent } from "./content.ts";

/**
 * Factory function type for creating ZypherAgent instances per session.
 * The toolApprovalHandler parameter allows the factory to create an agent
 * with ACP permission request support.
 */
export type AgentFactory = (
  cwd: string,
  mcpServers?: acp.McpServer[],
  toolApprovalHandler?: ToolApprovalHandler,
) => Promise<ZypherAgent>;

/**
 * Session state for an ACP session.
 */
interface AcpSession {
  agent: ZypherAgent;
  abort: AbortController | null;
  toolCallIds: Map<string, string>;
}

/**
 * ACPProtocolAdapter implements the acp.Agent interface, adapting
 * ZypherAgent instances to the ACP protocol.
 */
export class ACPProtocolAdapter implements acp.Agent {
  readonly #conn: acp.AgentSideConnection;
  readonly #factory: AgentFactory;
  readonly #sessions = new Map<string, AcpSession>();
  readonly #defaultModel: string;

  constructor(
    conn: acp.AgentSideConnection,
    factory: AgentFactory,
  ) {
    this.#conn = conn;
    this.#factory = factory;
    this.#defaultModel = Deno.env.get("ZYPHER_MODEL") ??
      "claude-sonnet-4-20250514";
  }

  initialize(
    _params: acp.InitializeRequest,
  ): Promise<acp.InitializeResponse> {
    return Promise.resolve({
      protocolVersion: 1,
      agentInfo: {
        name: "zypher-agent",
        title: "Zypher Agent",
        version: "0.1.0",
      },
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {
          image: true,
          embeddedContext: true,
        },
        mcpCapabilities: {
          http: true,
        },
      },
    });
  }

  async newSession(
    params: acp.NewSessionRequest,
  ): Promise<acp.NewSessionResponse> {
    const sessionId = crypto.randomUUID();
    const agent = await this.#factory(params.cwd, params.mcpServers);

    this.#sessions.set(sessionId, {
      agent,
      abort: null,
      toolCallIds: new Map(),
    });

    return { sessionId };
  }

  authenticate(
    _params: acp.AuthenticateRequest,
  ): Promise<acp.AuthenticateResponse | void> {
    return Promise.resolve({});
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = this.#sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session ${params.sessionId} not found`);
    }

    session.abort?.abort();
    session.abort = new AbortController();
    // TODO: support image and file in prompts
    const { text: promptText } = convertPromptContent(params.prompt);

    try {
      const observable = session.agent.runTask(
        promptText,
        this.#defaultModel,
        undefined,
        { signal: session.abort.signal },
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
      if (session.abort.signal.aborted) {
        return { stopReason: "cancelled" };
      }
      throw _error;
    } finally {
      session.abort = null;
    }
  }

  cancel(params: acp.CancelNotification): Promise<void> {
    const session = this.#sessions.get(params.sessionId);
    if (session?.abort) {
      session.abort.abort();
      session.abort = null;
    }
    return Promise.resolve();
  }

  #handleTaskEvent(sessionId: string, event: TaskEvent): void {
    const session = this.#sessions.get(sessionId);
    if (!session) return;

    switch (event.type) {
      case "text":
        this.#conn.sessionUpdate({
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
        this.#conn.sessionUpdate({
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
          this.#conn.sessionUpdate({
            sessionId,
            update: {
              title: event.toolName,
              sessionUpdate: "tool_call",
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
                this.#conn.sessionUpdate({
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
    if (
      name.includes("search") || name.includes("grep") || name.includes("find")
    ) return "search";
    if (
      name.includes("run") || name.includes("exec") || name.includes("terminal")
    ) return "execute";
    return "other";
  }
}
