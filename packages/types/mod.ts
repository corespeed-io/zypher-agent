/**
 * Shared type definitions for the Zypher Agent ecosystem.
 *
 * This package is the single source of truth for types shared across
 * `@zypher/agent`, `@zypher/http`, and `@zypher/ui`. It contains no
 * runtime code and no Deno-specific APIs.
 *
 * @module
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// =============================================================================
// Message content blocks
// =============================================================================

export interface TextBlock {
  type: "text";
  text: string;
}

export interface Base64ImageSource {
  type: "base64";
  /** The base64 encoded image data */
  data: string;
  /** The MIME type of the image */
  mediaType: string;
}

export interface UrlImageSource {
  type: "url";
  /** The URL of the image */
  url: string;
  /** The MIME type of the image */
  mediaType: string;
}

export interface ImageBlock {
  type: "image";
  source: Base64ImageSource | UrlImageSource;
}

export interface ToolUseBlock {
  type: "tool_use";
  /** The ID of the tool use */
  toolUseId: string;
  /** The name of the tool the agent requested to use */
  name: string;
  /** The input parameters for the tool */
  input: unknown;
}

export interface ToolResultBlock {
  type: "tool_result";
  /** The ID of the tool use */
  toolUseId: string;
  /** The name of the tool that was used */
  name: string;
  /** The input parameters for the tool */
  input: unknown;
  /** Whether the tool execution was successful */
  success: boolean;
  /** The content of the tool result */
  content: (TextBlock | ImageBlock)[];
}

export interface FileAttachment {
  type: "file_attachment";
  /** The ID of the file in storage */
  fileId: string;
  /** The MIME type of the file */
  mimeType: string;
}

export interface ThinkingBlock {
  type: "thinking";
  /** An opaque field and should not be interpreted or parsed - it exists solely for verification purposes. */
  signature: string;
  /** The content of the thinking block */
  thinking: string;
}

export type ContentBlock =
  | TextBlock
  | ImageBlock
  | ToolUseBlock
  | ToolResultBlock
  | FileAttachment
  | ThinkingBlock;

// =============================================================================
// Message
// =============================================================================

/**
 * Extended message parameter type that includes checkpoint information
 */
export interface Message {
  content: Array<ContentBlock>;
  role: "user" | "assistant";
  /** Timestamp indicating when the message was created */
  timestamp: Date;
  /** Optional reference to a checkpoint created before this message */
  checkpointId?: string;
  /** Optional metadata about the checkpoint */
  checkpoint?: {
    id: string;
    name: string;
    timestamp: string;
  };
}

// =============================================================================
// LLM types
// =============================================================================

/**
 * Token usage information from an LLM response.
 */
export interface TokenUsage {
  /** Input/prompt token usage */
  input: {
    /** Total input tokens */
    total: number;
    /** Tokens used to create new cache entries (Anthropic only) */
    cacheCreation?: number;
    /** Tokens read from cache (cache hit) */
    cacheRead?: number;
  };
  /** Output/completion token usage */
  output: {
    /** Total output tokens */
    total: number;
    /** Tokens used for reasoning/thinking (OpenAI reasoning models) */
    thinking?: number;
  };
  /** Total tokens (input.total + output.total) */
  total: number;
}

export interface FinalMessage extends Message {
  /**
   * The reason the model stopped generating.
   *  "end_turn" - the model reached a natural stopping point
   *  "max_tokens" - we exceeded the requested max_tokens or the model's maximum
   *  "stop_sequence" - one of your provided custom stop_sequences was generated
   *  "tool_use" - the model invoked one or more tools
   */
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use";
  /** Token usage for this response (undefined if provider doesn't return usage data) */
  usage?: TokenUsage;
}

// =============================================================================
// MCP types
// =============================================================================

/** Possible state values from the McpClient state machine */
export type McpClientStatus =
  | "disconnected"
  | { connecting: "initializing" | "awaitingOAuth" }
  | { connected: "initial" | "toolDiscovered" }
  | "disconnecting"
  | "disconnectingDueToError"
  | "error"
  | "aborting"
  | "disposed";

/** Command configuration for local MCP server execution */
export interface McpCommandConfig {
  /** Command to execute the MCP server */
  command: string;
  /** Arguments to pass to the command */
  args?: string[];
  /** Environment variables for the server */
  env?: Record<string, string>;
}

/** Remote connection configuration for external MCP servers */
export interface McpRemoteConfig {
  /** Connection URL for the remote server */
  url: string;
  /** Custom headers for the connection */
  headers?: Record<string, string>;
}

/** Server endpoint information for connecting to an MCP server */
export type McpServerEndpoint =
  & {
    /** Kebab-case identifier used as key (e.g., "github-copilot") */
    id: string;
    /** Human-readable display name (e.g., "GitHub Copilot") */
    displayName?: string;
  }
  & (
    | {
      type: "command";
      /** CLI command configuration for local server execution */
      command: McpCommandConfig;
    }
    | {
      type: "remote";
      /** Remote server configuration for HTTP/SSE connections */
      remote: McpRemoteConfig;
    }
  );

/**
 * Metadata about where an MCP server came from
 *
 * - `registry`: Server was registered from the MCP Store registry.
 *   Contains the package identifier (e.g., "@modelcontextprotocol/server-filesystem")
 * - `direct`: Server was registered directly by the user with explicit configuration
 */
export type McpServerSource =
  | { type: "registry"; packageIdentifier: string }
  | { type: "direct" };

// =============================================================================
// Task events
// =============================================================================

/** Event for streaming incremental content updates */
export interface TaskTextEvent {
  type: "text";
  content: string;
}

/**
 * Event emitted when a complete message is added to the chat history.
 * This includes both new messages from the LLM and new messages added by interceptors.
 */
export interface TaskMessageEvent {
  type: "message";
  message: Message | FinalMessage;
}

/**
 * Event for when existing chat history (previous messages) is modified.
 */
export interface TaskHistoryChangedEvent {
  type: "history_changed";
}

/** Event emitted when the LLM indicates intent to call a tool */
export interface TaskToolUseEvent {
  type: "tool_use";
  toolUseId: string;
  toolName: string;
}

/** Event emitted when partial tool input is being streamed */
export interface TaskToolUseInputEvent {
  type: "tool_use_input";
  toolUseId: string;
  toolName: string;
  partialInput: string;
}

/** Event emitted when a tool execution requires user approval */
export interface TaskToolUsePendingApprovalEvent {
  type: "tool_use_pending_approval";
  toolUseId: string;
  toolName: string;
  input: unknown;
}

/** Event emitted when a tool execution is rejected by the user */
export interface TaskToolUseRejectedEvent {
  type: "tool_use_rejected";
  toolUseId: string;
  toolName: string;
  reason: string;
}

/** Event emitted when a tool execution is approved by the user */
export interface TaskToolUseApprovedEvent {
  type: "tool_use_approved";
  toolUseId: string;
  toolName: string;
}

/**
 * The result of a tool execution.
 */
export type ToolResult = CallToolResult | string;

/** Event emitted when a tool execution completes successfully */
export interface TaskToolUseResultEvent {
  type: "tool_use_result";
  toolUseId: string;
  toolName: string;
  input: unknown;
  result: ToolResult;
}

/** Event emitted when a tool execution fails with an error */
export interface TaskToolUseErrorEvent {
  type: "tool_use_error";
  toolUseId: string;
  toolName: string;
  input: unknown;
  error: unknown;
}

/** Event emitted when a tool execution is cancelled via AbortSignal */
export interface TaskToolUseCancelledEvent {
  type: "tool_use_cancelled";
  toolUseId: string;
  toolName: string;
  input: unknown;
}

/** Event emitted when an interceptor starts execution */
export interface TaskInterceptorUseEvent {
  type: "interceptor_use";
  interceptorName: string;
}

/** Event emitted when an interceptor completes execution */
export interface TaskInterceptorResultEvent {
  type: "interceptor_result";
  interceptorName: string;
  decision: "continue" | "complete";
}

/** Event emitted when an interceptor throws an error */
export interface TaskInterceptorErrorEvent {
  type: "interceptor_error";
  interceptorName: string;
  error: unknown;
}

/** Event emitted when a task is cancelled by user or timeout */
export interface TaskCancelledEvent {
  type: "cancelled";
  reason: "user" | "timeout";
}

/** Event emitted after each LLM response with token usage information */
export interface TaskUsageEvent {
  type: "usage";
  /** Token usage for the current LLM call */
  usage: TokenUsage;
  /** Cumulative token usage across all LLM calls in this task */
  cumulativeUsage: TokenUsage;
}

/** Event emitted when a task completes successfully */
export interface TaskCompletedEvent {
  type: "completed";
  /** Total token usage for the entire task (undefined if provider didn't return usage data) */
  totalUsage?: TokenUsage;
}

export type TaskEvent =
  | TaskTextEvent
  | TaskMessageEvent
  | TaskHistoryChangedEvent
  | TaskToolUseEvent
  | TaskToolUseInputEvent
  | TaskToolUsePendingApprovalEvent
  | TaskToolUseRejectedEvent
  | TaskToolUseApprovedEvent
  | TaskToolUseResultEvent
  | TaskToolUseErrorEvent
  | TaskToolUseCancelledEvent
  | TaskInterceptorUseEvent
  | TaskInterceptorResultEvent
  | TaskInterceptorErrorEvent
  | TaskCancelledEvent
  | TaskUsageEvent
  | TaskCompletedEvent;

// =============================================================================
// HTTP task events
// =============================================================================

/** Heartbeat event data */
export interface HeartbeatEvent {
  type: "heartbeat";
  timestamp: number;
}

/**
 * Standard error event sent when `exposeErrors` is enabled.
 */
export interface StandardErrorEvent {
  type: "error";
  /** Error name/type (e.g., "Error", "TypeError", "APIError") */
  name: string;
  /** Error message */
  message: string;
  /** Stack trace (if available) */
  stack?: string;
}

/**
 * Custom error event sent when using `onError`.
 */
export interface CustomErrorEvent {
  type: "error";
  /** Custom fields from onError */
  [key: string]: unknown;
}

/**
 * Error event sent to the client before closing the WebSocket on error.
 */
export type ErrorEvent = StandardErrorEvent | CustomErrorEvent;

/** Opaque event ID with ordering semantics (format: `task_<timestamp>_<sequence>`). */
export interface HttpTaskEventId {
  toString(): string;
  toJSON(): string;
  isAfter(other: HttpTaskEventId): boolean;
  readonly timestamp: number;
  readonly sequence: number;
}

export type HttpTaskEvent =
  & (TaskEvent | HeartbeatEvent | ErrorEvent)
  & { eventId: HttpTaskEventId };

// =============================================================================
// WebSocket message types
// =============================================================================

/**
 * Messages sent from the client to the server over the task WebSocket.
 */
export type TaskWebSocketClientMessage =
  | { action: "startTask"; task: string; fileAttachments?: string[] }
  | { action: "resumeTask"; lastEventId?: string }
  | { action: "cancelTask" }
  | { action: "approveTool"; approved: boolean };

/** Messages sent from the server to the client over the task WebSocket. */
export type TaskWebSocketServerMessage = HttpTaskEvent;

/** All messages that can be sent over the task WebSocket (both directions). */
export type TaskWebSocketMessage =
  | TaskWebSocketClientMessage
  | TaskWebSocketServerMessage;

// =============================================================================
// MCP WebSocket events
// =============================================================================

/**
 * Events sent over the MCP WebSocket connection (/mcp/ws).
 */
export type McpWebSocketEvent =
  | {
    /** Sent immediately on connection with the current state of all servers */
    type: "initial_state";
    servers: Array<{
      serverId: string;
      server: McpServerEndpoint;
      source: McpServerSource;
      status: McpClientStatus;
      enabled: boolean;
      /** Present when OAuth authentication is required */
      pendingOAuthUrl?: string;
    }>;
  }
  | {
    /** Emitted when a new MCP server is registered */
    type: "server_added";
    serverId: string;
    server: McpServerEndpoint;
    source: McpServerSource;
  }
  | {
    /** Emitted when server configuration or enabled state changes */
    type: "server_updated";
    serverId: string;
    updates: { server?: McpServerEndpoint; enabled?: boolean };
  }
  | {
    /** Emitted when a server is deregistered */
    type: "server_removed";
    serverId: string;
  }
  | {
    /** Emitted when client connection status changes (connecting, connected, error, etc.) */
    type: "client_status_changed";
    serverId: string;
    status: McpClientStatus;
    /** Present when status is "awaitingOAuth" - URL for user to complete OAuth flow */
    pendingOAuthUrl?: string;
  }
  | {
    /** Emitted on subscription errors */
    type: "error";
    /** Custom fields from onError callback */
    [key: string]: unknown;
  };
