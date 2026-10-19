import type {
  FinalMessage,
  ModelEvent,
  ModelProvider,
  ModelProviderOptions,
  ModelStream,
  ProviderInfo,
  StreamChatParams,
  TokenUsage,
} from "./model_provider.ts";
import { Anthropic, type ClientOptions } from "@anthropic-ai/sdk";
import type { ContentBlock, ImageBlock, Message } from "../message.ts";
import { Observable } from "rxjs";
import type { FileAttachmentCacheMap } from "../storage/mod.ts";
import * as z from "zod";
import { injectOutputSchema } from "./utils.ts";

const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

function isSupportedImageType(
  type: string,
): type is typeof SUPPORTED_IMAGE_TYPES[number] {
  return SUPPORTED_IMAGE_TYPES.includes(
    type as typeof SUPPORTED_IMAGE_TYPES[number],
  );
}

export interface AnthropicModelProviderOptions extends ModelProviderOptions {
  /**
   * The model to use (e.g., "claude-sonnet-4-20250514").
   */
  model: string;
  enablePromptCaching?: boolean;
  /**
   * The budget for thinking in tokens.
   * @see https://docs.anthropic.com/en/docs/build-with-claude/thinking/thinking-budget
   */
  thinkingBudget?: number;
  anthropicClientOptions?: ClientOptions;
}

export class AnthropicModelProvider implements ModelProvider {
  readonly #model: string;
  #client: Anthropic;
  #enablePromptCaching: boolean;
  #thinkingConfig: Anthropic.ThinkingConfigParam | undefined;

  constructor(options: AnthropicModelProviderOptions) {
    this.#model = options.model;
    this.#client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
      ...options.anthropicClientOptions,
    });
    // MiniMax manages prompt caching automatically and does not accept cache_control.
    const isMiniMax = options.model === "MiniMax-M3.1-Flash" ||
      options.model === "MiniMax-M3";
    this.#enablePromptCaching = !isMiniMax &&
      (options.enablePromptCaching ?? true);
    // Flash always uses adaptive thinking; omit legacy budget/disabled settings.
    if (options.model === "MiniMax-M3.1-Flash") {
      this.#thinkingConfig = undefined;
    } else if (options.model === "MiniMax-M3" && options.thinkingBudget) {
      // M3 accepts adaptive thinking, not Claude's fixed token budget.
      this.#thinkingConfig = {
        // @ts-expect-error The pinned SDK predates MiniMax's adaptive thinking type.
        type: "adaptive",
      };
    } else {
      this.#thinkingConfig = options.thinkingBudget
        ? { type: "enabled", budget_tokens: options.thinkingBudget }
        : { type: "disabled" };
    }
  }

  get info(): ProviderInfo {
    return {
      name: "anthropic",
      version: "1.0.0",
      capabilities: [
        "caching",
        "thinking",
        "vision",
        "documents",
        "tool_calling",
      ],
    };
  }

  get modelId(): string {
    return this.#model;
  }

  streamChat(
    params: StreamChatParams,
    fileAttachmentCacheMap?: FileAttachmentCacheMap,
  ): ModelStream {
    // Convert our internal Message[] to Anthropic's MessageParam[]
    // Filter out empty assistant messages (except the final one) to avoid API error:
    // "all messages must have non-empty content except for the optional final assistant message"
    const anthropicMessages = params.messages
      .map((msg, index) =>
        this.#formatMessageForApi(
          msg,
          index === params.messages.length - 1,
          fileAttachmentCacheMap,
        )
      )
      .filter((msg, index, arr) => {
        const isLastMessage = index === arr.length - 1;
        const isEmpty = Array.isArray(msg.content) && msg.content.length === 0;
        // Filter out non-final empty assistant messages
        return !(isEmpty && msg.role === "assistant" && !isLastMessage);
      });

    // Convert our internal Tool[] to Anthropic's Tool[]
    const anthropicTools = params.tools?.map((
      tool,
      index,
    ): Anthropic.ToolUnion => ({
      name: tool.name,
      description: injectOutputSchema(tool.description, tool.outputSchema),
      input_schema: z.toJSONSchema(tool.schema) as Anthropic.Tool.InputSchema,
      ...(params.tools && index === params.tools.length - 1 && {
        // cache the last tool as it's large and reusable
        ...(this.#enablePromptCaching && {
          cache_control: { type: "ephemeral" },
        }),
      }),
    }));

    const stream = this.#client.messages.stream(
      {
        model: this.#model,
        max_tokens: params.maxTokens,
        system: [
          {
            type: "text",
            text: params.system,
            // cache the main system prompt (if enabled) as it's large and reusable
            ...(this.#enablePromptCaching && {
              cache_control: { type: "ephemeral" },
            }),
          },
        ],
        messages: anthropicMessages,
        tools: anthropicTools,
        thinking: this.#thinkingConfig,
        metadata: {
          user_id: params.userId,
        },
      },
      { signal: params.signal },
    );

    return new AnthropicModelStream(stream);
  }

  /**
   * Formats a message for the Anthropic API, converting content to blocks and adding cache control
   * for incremental caching of conversation history.
   *
   * @param message - The extended message parameter
   * @param isLastMessage - Whether this is the last message in the turn
   * @returns A clean message parameter for the Anthropic API
   */
  #formatMessageForApi(
    message: Message,
    isLastMessage: boolean,
    fileAttachmentCacheMap?: FileAttachmentCacheMap,
  ): Anthropic.MessageParam {
    const { role, content } = message;

    // Track file attachment count separately from content index
    let fileAttachmentCount = 0;

    // For string content, convert to array format
    let contentArray = typeof content === "string"
      ? [
        {
          type: "text" as const,
          text: content,
        } satisfies Anthropic.TextBlockParam,
      ]
      : content.map(
        (
          block,
        ):
          | Anthropic.ContentBlockParam
          | Anthropic.ContentBlockParam[]
          | null => {
          if (block.type === "file_attachment") {
            const cache = fileAttachmentCacheMap?.[block.fileId];
            if (!cache) {
              return null;
            }
            // Increment the file attachment counter for each file attachment
            fileAttachmentCount++;

            const attachmentIndex = fileAttachmentCount;

            // Text block is always included for both image and PDF files
            const textBlock: Anthropic.TextBlockParam = {
              type: "text" as const,
              text: `Attachment ${attachmentIndex}:
MIME type: ${block.mimeType}
Cached at: ${cache.cachePath}`,
            };

            // Handle different file types with appropriate block types
            if (isSupportedImageType(block.mimeType)) {
              return [
                textBlock,
                {
                  type: "image" as const,
                  source: {
                    type: "url" as const,
                    url: cache.signedUrl,
                  },
                } satisfies Anthropic.ImageBlockParam,
              ];
            } else if (block.mimeType === "application/pdf") {
              return [
                textBlock,
                {
                  type: "document" as const,
                  source: {
                    type: "url" as const,
                    url: cache.signedUrl,
                  },
                } satisfies Anthropic.DocumentBlockParam,
              ];
            }

            // Fall back to just the text block for unsupported types
            return [textBlock];
          } else if (block.type === "image") {
            return mapImageBlockToA7cBlock(block);
          } else if (block.type === "tool_use") {
            return {
              type: "tool_use" as const,
              id: block.toolUseId,
              name: block.name,
              input: block.input,
            } satisfies Anthropic.ToolUseBlockParam;
          } else if (block.type === "tool_result") {
            return {
              type: "tool_result" as const,
              tool_use_id: block.toolUseId,
              content: block.content.map(
                (c): Anthropic.TextBlockParam | Anthropic.ImageBlockParam => {
                  if (c.type === "text") {
                    return {
                      type: "text" as const,
                      text: c.text,
                    } satisfies Anthropic.TextBlockParam;
                  } else {
                    return mapImageBlockToA7cBlock(c);
                  }
                },
              ),
            } satisfies Anthropic.ToolResultBlockParam;
          } else if (block.type === "thinking") {
            return {
              type: "thinking" as const,
              signature: block.signature,
              thinking: block.thinking,
            } satisfies Anthropic.ThinkingBlockParam;
          } else {
            return {
              type: "text" as const,
              text: block.text,
            } satisfies Anthropic.TextBlockParam;
          }
        },
      )
        .flat()
        .filter((block): block is Anthropic.ContentBlockParam =>
          block !== null
        );

    // Add cache control to the last block of the last message
    if (isLastMessage && this.#enablePromptCaching && contentArray.length > 0) {
      // Only create new array for the last message to avoid mutating the original array
      contentArray = [
        ...contentArray.slice(0, -1), // Keep all but the last block
        // inject cache control to the last block
        // refer to https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching#continuing-a-multi-turn-conversation
        {
          ...contentArray[contentArray.length - 1],
          cache_control: { type: "ephemeral" },
        } as Anthropic.ContentBlockParam,
      ];
    }

    return { role, content: contentArray };
  }
}

class AnthropicModelStream implements ModelStream {
  readonly #stream: ReturnType<Anthropic["messages"]["stream"]>;
  readonly #events: Observable<ModelEvent>;

  constructor(stream: ReturnType<Anthropic["messages"]["stream"]>) {
    this.#stream = stream;
    this.#events = new Observable((subscriber) => {
      // Track the current tool use id and name for subsequent inputJson events
      let currentToolUseId: string | null = null;
      let currentToolName: string | null = null;

      stream
        .on("streamEvent", (event: Anthropic.MessageStreamEvent) => {
          // Detect tool use at the start of a content block
          if (
            event.type === "content_block_start" &&
            event.content_block?.type === "tool_use"
          ) {
            // Store the tool use id and name for subsequent inputJson events
            currentToolUseId = event.content_block.id;
            currentToolName = event.content_block.name;
            // Send the initial tool use notification with the tool name and id
            subscriber.next({
              type: "tool_use",
              toolUseId: currentToolUseId,
              toolName: currentToolName,
            });
          }
        })
        .on("text", (text) => {
          subscriber.next({ type: "text", content: text });
        })
        .on("inputJson", (inputJson) => {
          // Send updates whenever we have new partial JSON for a tool
          if (inputJson && currentToolUseId && currentToolName) {
            subscriber.next({
              type: "tool_use_input",
              toolUseId: currentToolUseId,
              toolName: currentToolName,
              partialInput: inputJson,
            });
          }
        })
        .on("message", (message) => {
          subscriber.next({
            type: "message",
            message: mapA7cMessageToMessage(message),
          });
        })
        .on("error", (error) => {
          subscriber.error(error);
        })
        .on("end", () => {
          subscriber.complete();
        });
    });
  }

  get events(): Observable<ModelEvent> {
    return this.#events;
  }

  async finalMessage(): Promise<FinalMessage> {
    const finalMessage = await this.#stream.finalMessage();
    return mapA7cMessageToMessage(finalMessage);
  }
}

/** Map Anthropic message to our internal message */
function mapA7cMessageToMessage(message: Anthropic.Message): FinalMessage {
  return {
    role: message.role,
    content: message.content.map(mapA7cContentBlockToContentBlock).filter((
      block,
    ): block is ContentBlock => block !== null),
    timestamp: new Date(),
    stop_reason: mapA7cStopReason(message.stop_reason),
    usage: mapA7cUsage(message.usage),
  };
}

/** Map Anthropic usage to our internal TokenUsage */
function mapA7cUsage(usage: Anthropic.Usage): TokenUsage {
  return {
    input: {
      total: usage.input_tokens,
      cacheCreation: usage.cache_creation_input_tokens ?? undefined,
      cacheRead: usage.cache_read_input_tokens ?? undefined,
    },
    output: {
      total: usage.output_tokens,
    },
    total: usage.input_tokens + usage.output_tokens,
  };
}

/** Map Anthropic content block to our internal content block */
function mapA7cContentBlockToContentBlock(
  block: Anthropic.ContentBlock,
): ContentBlock | null {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "tool_use":
      return {
        type: "tool_use",
        toolUseId: block.id,
        name: block.name,
        input: block.input,
      };
    case "thinking":
      return {
        type: "thinking",
        signature: block.signature,
        thinking: block.thinking,
      };
    default:
      return null;
  }
}

/** Map Anthropic stop reason to our internal stop reason */
function mapA7cStopReason(
  reason: Anthropic.Messages.StopReason | null,
): FinalMessage["stop_reason"] {
  switch (reason) {
    case "end_turn":
      return "end_turn";
    case "max_tokens":
      return "max_tokens";
    case "tool_use":
      return "tool_use";
    case "stop_sequence":
      return "stop_sequence";
    default:
      return "end_turn";
  }
}

/** Map our internal image block to Anthropic image block
 *  or text block with warning if the image type is unsupported */
function mapImageBlockToA7cBlock(
  block: ImageBlock,
): Anthropic.ImageBlockParam | Anthropic.TextBlockParam {
  if (isSupportedImageType(block.source.mediaType)) {
    if (block.source.type === "base64") {
      return {
        type: "image" as const,
        source: {
          type: "base64",
          data: block.source.data,
          media_type: block.source.mediaType,
        },
      } satisfies Anthropic.ImageBlockParam;
    } else {
      return {
        type: "image" as const,
        source: {
          type: "url",
          url: block.source.url,
        },
      } satisfies Anthropic.ImageBlockParam;
    }
  } else {
    // Return a text block informing the model about the unsupported image type
    return {
      type: "text" as const,
      text:
        `You provided an unsupported image source (MIME type: ${block.source.mediaType}), this image will not be shown to the model.`,
    } satisfies Anthropic.TextBlockParam;
  }
}
