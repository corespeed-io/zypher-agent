import type { Observable } from "rxjs";
import type {
  FinalMessage,
  Message,
  TaskTextEvent,
  TaskToolUseEvent,
  TaskToolUseInputEvent,
} from "@zypher/types";
import type { Tool } from "../tools/mod.ts";
import type { FileAttachmentCacheMap } from "../storage/mod.ts";

export interface ModelProviderOptions {
  /**
   * API key for authentication.
   * Optional when using an API proxy (e.g., Cloudflare AI Gateway) that handles
   * authentication separately, or when using custom headers via provider-specific
   * client options.
   */
  apiKey?: string;
  baseUrl?: string;
}

export interface StreamChatParams {
  maxTokens: number;
  system: string;
  messages: Message[];
  userId?: string;
  tools?: Tool[];
  signal?: AbortSignal;
}

/**
 * Provider capabilities
 */
export type ProviderCapability =
  | "caching"
  | "thinking"
  | "vision"
  | "documents"
  | "tool_calling";

/**
 * Provider information
 */
export interface ProviderInfo {
  name: string;
  version: string;
  capabilities: ProviderCapability[];
}

/**
 * Abstraction that a concrete large-language-model provider (Anthropic,
 * OpenAI, etc.) must implement. A ModelProvider represents both a specific
 * provider AND a specific model from that provider.
 */
export interface ModelProvider {
  /**
   * Get provider information.
   */
  get info(): ProviderInfo;

  /**
   * Get the model identifier (e.g., "claude-sonnet-4-20250514", "gpt-4o").
   */
  get modelId(): string;

  /**
   * Request a streaming chat completion.  The returned object must satisfy the
   * structural `LLMStream` interface so that downstream code can interact with
   * it in a provider-agnostic manner.
   */
  streamChat(
    params: StreamChatParams,
    fileAttachmentCacheMap?: FileAttachmentCacheMap,
  ): ModelStream;
}

export interface ModelStream {
  /**
   * Get an observable that emits the next message in the stream.
   */
  get events(): Observable<ModelEvent>;

  /**
   * Wait for the stream to complete and get the final message
   */
  finalMessage(): Promise<FinalMessage>;
}

// Re-export shared types from @zypher/types
export type { FinalMessage, TokenUsage } from "@zypher/types";

/**
 * Event emitted when a complete message is received from the model
 */
export interface ModelMessageEvent {
  type: "message";
  message: FinalMessage;
}

export type ModelEvent =
  | ModelMessageEvent
  | TaskTextEvent
  | TaskToolUseEvent
  | TaskToolUseInputEvent;
