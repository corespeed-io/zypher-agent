/**
 * ACP Protocol Adapter
 *
 * Implements the acp.Agent interface, bridging ZypherAgent's task execution
 * to the ACP protocol.
 */

import type * as acp from "acp";
import type { ZypherAgent } from "../ZypherAgent.ts";
import type { TaskEvent } from "../TaskEvents.ts";
import type { ToolResult } from "../tools/mod.ts";
import { convertPromptContent } from "./content.ts";

/**
 * Extracts success status and content string from a ToolResult
 */
function extractToolResult(result: ToolResult): {
  success: boolean;
  content: string;
} {
  if (typeof result === "string") {
    return { success: true, content: result };
  }

  const success = !result.isError;

  if (result.structuredContent) {
    return { success, content: JSON.stringify(result.structuredContent) };
  }

  const content = result.content
    .map((c) => {
      if (c.type === "text") return c.text;
      if (c.type === "image") return "[image]";
      return JSON.stringify(c);
    })
    .join("\n");

  return { success, content };
}

export type AgentFactory = (
  cwd: string,
  mcpServers?: acp.McpServer[],
) => Promise<ZypherAgent>;

interface AcpSession {
  agent: ZypherAgent;
  abort: AbortController | null;
  toolCallIds: Map<string, string>;
}

export class ACPProtocolAdapter implements acp.Agent {
  readonly #conn: acp.AgentSideConnection;
  readonly #factory: AgentFactory;
  readonly #sessions = new Map<string, AcpSession>();
  readonly #defaultModel: string;

  constructor(conn: acp.AgentSideConnection, factory: AgentFactory) {
    this.#conn = conn;
    this.#factory = factory;
    this.#defaultModel = Deno.env.get("ZYPHER_MODEL") ??
      "claude-sonnet-4-20250514";
  }

  initialize(_params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
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
    } catch (error) {
      if (session.abort.signal.aborted) {
        return { stopReason: "cancelled" };
      }
      throw error;
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
              sessionUpdate: "tool_call_update",
              toolCallId,
              rawInput: event.partialInput,
              status: "in_progress",
            },
          });
        }
        break;
      }

      case "tool_use_result": {
        const toolCallId = session.toolCallIds.get(event.toolName);
        if (toolCallId) {
          const { success, content } = extractToolResult(event.result);
          this.#conn.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId,
              status: success ? "completed" : "failed",
              rawOutput: content,
            },
          });
          session.toolCallIds.delete(event.toolName);
        }
        break;
      }

      case "tool_use_error": {
        const toolCallId = session.toolCallIds.get(event.toolName);
        if (toolCallId) {
          this.#conn.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId,
              status: "failed",
              rawOutput: String(event.error),
            },
          });
          session.toolCallIds.delete(event.toolName);
        }
        break;
      }

      case "message":
        // Tool results are now handled by tool_use_result event
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
      name.includes("search") ||
      name.includes("grep") ||
      name.includes("find")
    ) {
      return "search";
    }
    if (
      name.includes("run") ||
      name.includes("exec") ||
      name.includes("terminal")
    ) {
      return "execute";
    }
    return "other";
  }
}
