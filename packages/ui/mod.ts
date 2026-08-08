/**
 * React hooks and utilities for Zypher Agent UI integration.
 *
 * - **TaskApiClient**: WebSocket and REST client for agent task execution
 * - **useAgent / AgentProvider**: React hooks for managing agent state and messages
 * - **useMcpServers**: Real-time MCP server status via WebSocket
 *
 * @example
 * ```tsx
 * import { TaskApiClient, useAgent } from "@zypher/ui";
 *
 * const client = new TaskApiClient({
 *   baseUrl: "http://localhost:8080",
 * });
 *
 * function Chat() {
 *   const { messages, runTask, isTaskRunning } = useAgent({ client });
 *
 *   return (
 *     <div>
 *       {messages.map((m) => <Message key={m.id} message={m} />)}
 *       <button onClick={() => runTask("Hello!")}>Send</button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @module
 */

// MCP server hooks and types
export { matchStatus, useMcpServers } from "./use_mcp_servers.ts";
export type {
  McpClientStatusPattern,
  McpConnectionStatus,
  McpServerState,
  UseMcpServersOptions,
  UseMcpServersReturn,
} from "./use_mcp_servers.ts";

// Agent context provider and hook
export { AgentProvider, useAgentContext } from "./agent_context.ts";
export type { AgentProviderOptions } from "./agent_context.ts";

// Agent hook and types
export {
  generateMessageId,
  getFormattedToolName,
  useAgent,
} from "./use_agent.ts";
export type {
  CompleteMessage,
  CustomContentBlock,
  EventState,
  StreamingMessage,
  StreamingTextMessage,
  StreamingToolUseMessage,
  UseAgentOptions,
  UseAgentReturn,
} from "./use_agent.ts";

// Task API client
export { TaskApiClient } from "./task_api_client.ts";
export type {
  StartTaskOptions,
  TaskApiClientOptions,
  TaskConnection,
} from "./task_api_client.ts";

// Utilities
export { toWebSocketUrl } from "./utils.ts";

// Re-exported types from @zypher/types
export type {
  ContentBlock,
  FileAttachment,
  HttpTaskEvent,
  HttpTaskEventId,
  ImageBlock,
  McpClientStatus,
  McpServerEndpoint,
  McpServerSource,
  TextBlock,
  ThinkingBlock,
  ToolResultBlock,
  ToolUseBlock,
} from "@zypher/types";
