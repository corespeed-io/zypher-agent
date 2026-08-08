import { hexoid } from "hexoid";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { TaskApiClient, TaskConnection } from "./task_api_client.ts";
import type { ContentBlock } from "@zypher/types";
import type { TaskWebSocketServerMessage } from "@zypher/types";
import type { Observable } from "rxjs";
import { eachValueFrom } from "rxjs-for-await";
import useSWR, { type KeyedMutator } from "swr";

/** Custom content block with a type discriminator. */
export interface CustomContentBlock {
  type: string;
  [key: string]: unknown;
}

/** A fully received message from either the user or the assistant. */
export interface CompleteMessage {
  type: "complete";
  /** Unique identifier for this message. */
  id: string;
  /** Whether this message is from the user or the assistant. */
  role: "user" | "assistant";
  /** The content blocks of the message (text, tool use, tool result, or custom). */
  content: (ContentBlock | CustomContentBlock)[];
  /** When this message was created. */
  timestamp: Date;
  /** Checkpoint ID if this message has an associated checkpoint. */
  checkpointId?: string;
}

/** A message that is currently being streamed from the assistant. */
export type StreamingMessage = StreamingTextMessage | StreamingToolUseMessage;

/** A text message that is currently being streamed. */
export interface StreamingTextMessage {
  type: "streaming_text";
  /** Unique identifier for this streaming message. */
  id: string;
  /** The text content received so far. */
  text: string;
  /** When this streaming message started. */
  timestamp: Date;
}

/** A tool use message that is currently being streamed. */
export interface StreamingToolUseMessage {
  type: "streaming_tool_use";
  /** Unique identifier for this streaming message. */
  id: string;
  /** The name of the tool being invoked. */
  toolUseName: string;
  /** The partial JSON input received so far. */
  partialInput: string;
  /** When this streaming message started. */
  timestamp: Date;
}

const generateId = hexoid();

/**
 * Generates a unique message ID with the given prefix.
 *
 * @param prefix - The prefix indicating the message origin:
 *   - `"message"` - Complete messages received from the server
 *   - `"delta"` - Streaming message chunks (text or tool use in progress)
 *   - `"optimistic"` - User messages added before server confirmation
 *   - `"greeting"` - Initial greeting message shown to users
 * @returns A unique ID string in the format `{prefix}-{uniqueId}`
 */
export function generateMessageId(
  prefix: "message" | "delta" | "optimistic" | "greeting" = "message",
): string {
  return `${prefix}-${generateId()}`;
}

/**
 * Formats a tool name for display by removing the "mcp_" prefix if present.
 * @param toolName The raw tool name from the agent.
 * @returns The formatted tool name.
 */
export function getFormattedToolName(toolName: string): string {
  if (toolName.startsWith("mcp_")) {
    return toolName.replace("mcp_", "");
  }
  return toolName;
}

/** State passed to the onEvent callback for custom event handling. */
export interface EventState {
  /** Mutate the messages array (SWR KeyedMutator). */
  mutateMessages: KeyedMutator<CompleteMessage[]>;
  /** Set streaming messages state. */
  setStreamingMessages: Dispatch<SetStateAction<StreamingMessage[]>>;
}

/** Options for the {@link useAgent} hook. */
export interface UseAgentOptions {
  /**
   * Should auto resume task on mount.
   *
   * @default true
   */
  autoResume?: boolean;
  /** The TaskApiClient instance to use for communication with the agent server. */
  client: TaskApiClient;
  /**
   * Custom event handler for WebSocket events.
   * Return `true` to prevent default handling of the event.
   * Useful for handling custom events like "error" or extending built-in events.
   */
  onEvent?: (
    event: TaskWebSocketServerMessage,
    state: EventState,
  ) => boolean | void;
}

/** Return value of the {@link useAgent} hook. */
export interface UseAgentReturn {
  /** List of complete messages in the conversation. */
  messages: CompleteMessage[];
  /** List of messages currently being streamed. */
  streamingMessages: StreamingMessage[];
  /** Whether messages are being loaded from the server. */
  isLoadingMessages: boolean;
  /** Whether a task is currently running. */
  isTaskRunning: boolean;
  /** Whether messages are being cleared. */
  isClearingMessages: boolean;
  /** Start a new task with the given input. */
  runTask: (input: string, model?: string) => void;
  /** Resume a previously paused or interrupted task. */
  resumeTask: () => void;
  /** Clear all message history. */
  clearMessageHistory: () => void;
  /** Cancel the currently running task. */
  cancelCurrentTask: () => void;
  /** Mutate the messages array directly (SWR KeyedMutator). */
  mutateMessages: KeyedMutator<CompleteMessage[]>;
}

/**
 * React hook for managing agent conversation state.
 *
 * Handles message fetching, task execution via WebSocket, and streaming updates.
 * Uses SWR for message caching with automatic deduplication.
 *
 * @example
 * ```tsx
 * const { messages, runTask, isTaskRunning } = useAgent({ client });
 *
 * return (
 *   <div>
 *     {messages.map(m => <Message key={m.id} message={m} />)}
 *     <button onClick={() => runTask("Hello!")}>Send</button>
 *   </div>
 * );
 * ```
 */
export function useAgent(options: UseAgentOptions): UseAgentReturn {
  const { client, onEvent, autoResume = true } = options;
  // We use the bound mutate from useSWR for simpler access, but we can also use global mutate if needed.
  // actually, we need global mutate if we want to mutate other keys, but here we only mutate messageQueryKey.

  const [streamingMessages, setStreamingMessages] = useState<
    StreamingMessage[]
  >([]);
  const [isTaskRunning, setIsTaskRunning] = useState(false);

  const agentSocketRef = useRef<TaskConnection | null>(null);
  const hasAttemptedResumeRef = useRef(false);

  // Helper function to create a greeting message
  const createGreetingMessage = (): CompleteMessage => {
    return {
      type: "complete",
      id: generateMessageId("greeting"),
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Hello! How can I help you today?",
        },
      ],
      timestamp: new Date(),
    };
  };

  // === MESSAGE, TASK AND CHECKPOINT OPERATIONS ===

  // Derive SWR cache key from client baseUrl
  const messageQueryKey = ["messages", client.baseUrl] as const;

  const {
    data: messages = [],
    isLoading: isLoadingMessages,
    mutate: mutateMessages,
  } = useSWR(
    messageQueryKey,
    async () => {
      const messages = await client.getMessages();

      return [
        createGreetingMessage(),
        ...messages.map(
          (message) =>
            ({
              type: "complete",
              id: generateMessageId("message"),
              role: message.role,
              content: message.content,
              timestamp: new Date(message.timestamp),
              checkpointId: message.checkpointId,
            }) satisfies CompleteMessage,
        ),
      ];
    },
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      dedupingInterval: 60000, // Keep cache for a while
    },
  );

  const handleTaskEvents = useCallback(
    async (events$: Observable<TaskWebSocketServerMessage>) => {
      try {
        for await (const e of eachValueFrom(events$)) {
          // Call custom event handler first
          if (onEvent?.(e, { mutateMessages, setStreamingMessages })) {
            continue; // Skip default handling if handler returned true
          }

          switch (e.type) {
            case "text": {
              // ... same logic for streaming messages ...
              // Handle streaming text content - append to streaming message
              setStreamingMessages((prev: StreamingMessage[]) => {
                // Check if the last message is a streaming text message
                const lastMessage = prev.length > 0
                  ? prev[prev.length - 1]
                  : null;

                if (lastMessage?.type === "streaming_text") {
                  // Append to existing streaming text message
                  const updated = [...prev];
                  updated[prev.length - 1] = {
                    ...lastMessage,
                    text: lastMessage.text + e.content,
                  };
                  return updated;
                } else {
                  // Create new streaming text message
                  return [
                    ...prev,
                    {
                      type: "streaming_text",
                      id: generateMessageId("delta"),
                      text: e.content,
                      timestamp: new Date(),
                    },
                  ];
                }
              });
              break;
            }

            case "tool_use": {
              // ... same logic ...
              setStreamingMessages((prev: StreamingMessage[]) => {
                return [
                  ...prev,
                  {
                    type: "streaming_tool_use",
                    id: generateMessageId("delta"),
                    toolUseName: e.toolName,
                    partialInput: "",
                    timestamp: new Date(),
                  },
                ];
              });
              break;
            }

            case "tool_use_input": {
              // ... same logic ...
              setStreamingMessages((prev: StreamingMessage[]) => {
                // Check if the last message is a streaming tool use message with matching tool name
                const lastMessage = prev.length > 0
                  ? prev[prev.length - 1]
                  : null;

                if (
                  lastMessage?.type === "streaming_tool_use" &&
                  lastMessage.toolUseName === e.toolName
                ) {
                  // Update existing streaming tool use message
                  const updated = [...prev];
                  const accumulatedInput = lastMessage.partialInput +
                    e.partialInput;

                  updated[prev.length - 1] = {
                    ...lastMessage,
                    partialInput: accumulatedInput,
                  };

                  return updated;
                } else {
                  // Create new streaming tool use message if it doesn't exist
                  return [
                    ...prev,
                    {
                      type: "streaming_tool_use",
                      id: generateMessageId("delta"),
                      toolUseName: e.toolName,
                      partialInput: e.partialInput,
                      timestamp: new Date(),
                    },
                  ];
                }
              });
              break;
            }

            case "message": {
              // Handle complete message - add to message history
              const completeMessage: CompleteMessage = {
                type: "complete",
                id: generateMessageId("message"),
                role: e.message.role,
                content: e.message.content,
                timestamp: new Date(e.message.timestamp),
                checkpointId: e.message.checkpointId,
              };

              // queryClient.setQueryData replacement
              // mutateMessages(newData, false)
              mutateMessages(
                (prev: CompleteMessage[] | undefined) => [
                  ...(prev ?? []),
                  completeMessage,
                ],
                false, // do not revalidate yet
              );

              // Clear streaming messages since we have a complete message
              setStreamingMessages([]);
              break;
            }

            case "history_changed": {
              // History was modified - refetch all messages
              await mutateMessages();
              break;
            }

            case "cancelled": {
              // Task was cancelled
              console.log("Task cancelled:", e.reason);
              break;
            }

            case "completed": {
              break;
            }
          }
        }
        // Normal completion - task finished successfully
        console.log("[useAgent] Task completed");
      } catch (error) {
        // Handle WebSocket errors (including "task_not_running")
        console.error("Task error:", error);
      } finally {
        setIsTaskRunning(false);
        setStreamingMessages([]);
      }
    },
    [mutateMessages, onEvent],
  );

  // Function to clear message history
  const [isClearingMessages, startClearingMessagesTransition] = useTransition();
  const clearMessageHistory = useCallback(() => {
    if (isTaskRunning) {
      return;
    }

    startClearingMessagesTransition(async () => {
      try {
        await client.clearMessages();
        // Invalidate/Revalidate
        await mutateMessages();
      } catch (error) {
        console.error("Failed to clear message history:", error);
      }
    });
  }, [isTaskRunning, client, mutateMessages]);

  // Function to cancel the current task
  const cancelCurrentTask = useCallback(() => {
    if (!isTaskRunning) return;

    try {
      if (agentSocketRef.current === null) {
        throw new Error("No agent socket found");
      }

      agentSocketRef.current.cancelTask();

      // Success handling
      // Socket should handle cleanup via events, but we can force state reset
      setIsTaskRunning(false);
    } catch (error) {
      console.error("Failed to cancel task:", error);
    }
  }, [isTaskRunning]);

  const runTask = useCallback(
    async (input: string) => {
      if (!input.trim()) return;

      if (isTaskRunning) {
        throw new Error(
          "A task is already running. This may be caused by useAgent's automatic task resume is enabled by default.",
        );
      }

      // Create the user message object immediately after user input is sent
      const optimisticUserMessage: CompleteMessage = {
        type: "complete",
        id: generateMessageId("optimistic"),
        role: "user",
        content: [
          {
            type: "text",
            text: input,
          },
        ],
        timestamp: new Date(),
      };

      // Add user message to the chat immediately via optimistic update
      mutateMessages(
        (prev: CompleteMessage[] | undefined) => [
          ...(prev ?? []),
          optimisticUserMessage,
        ],
        false,
      );

      // Clear any streaming messages
      setStreamingMessages([]);
      // Set task running state
      setIsTaskRunning(true);

      try {
        const taskConnection = await client.startTask(input, {
          fileAttachments: [],
        });
        agentSocketRef.current = taskConnection;
        handleTaskEvents(taskConnection.events$);
      } catch (error) {
        console.error("Failed to start task:", error);
        setIsTaskRunning(false);
      }
    },
    [isTaskRunning, mutateMessages, client, handleTaskEvents],
  );

  // Resume a running task from agent (if exists)
  const resumeTask = useCallback(async () => {
    if (agentSocketRef.current !== null) {
      // Already have a connection
      return;
    }
    setIsTaskRunning(true);
    try {
      const taskConnection = await client.resumeTask();
      agentSocketRef.current = taskConnection;
      handleTaskEvents(taskConnection.events$);
    } catch (error) {
      console.error("Failed to resume task:", error);
      // If resume fails, we assume no task is running
      setIsTaskRunning(false);
    }
  }, [client, handleTaskEvents]);

  // Try to resume task ONLY ONCE if there is one after messages are loaded
  useEffect(() => {
    // Note: checking messages.length > 0 might be better than just messages truthy?
    // But since we initialize with [] fallback, we check if we have data loaded.
    // If isLoadingMessages is false and we have data.
    if (
      !isLoadingMessages && messages && !hasAttemptedResumeRef.current &&
      autoResume
    ) {
      hasAttemptedResumeRef.current = true;
      resumeTask();
    }
  }, [messages, isLoadingMessages, resumeTask, autoResume]);

  return {
    messages,
    streamingMessages,
    isLoadingMessages,
    isTaskRunning,
    isClearingMessages,
    runTask,
    resumeTask,
    clearMessageHistory,
    cancelCurrentTask,
    mutateMessages,
  };
}
