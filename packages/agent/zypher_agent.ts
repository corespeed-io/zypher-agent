import type { Checkpoint } from "./checkpoint_manager.ts";
import type { CheckpointManager } from "./checkpoint_manager.ts";
import type { ContentBlock, FileAttachment, Message } from "./message.ts";
import { McpServerManager } from "./mcp/mcp_server_manager.ts";
import type { StorageService } from "./storage/storage_service.ts";
import {
  addTokenUsage,
  createEmittingMessageArray,
  getSystemPrompt,
} from "./utils/mod.ts";
import type { ModelProvider, TokenUsage } from "./llm/mod.ts";
import { createModelProvider } from "./llm/mod.ts";
import { createAbortError, isAbortError } from "@zypher/utils";

/**
 * Error thrown when attempting to run a new task while another task is already running.
 */
export class TaskConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskConcurrencyError";
  }
}
import { filter, type Observable, Subject } from "rxjs";
import { eachValueFrom } from "rxjs-for-await";
import {
  type FileAttachmentCacheMap,
  FileAttachmentManager,
} from "./storage/mod.ts";
import {
  executeTools,
  type LoopInterceptor,
  LoopInterceptorManager,
} from "./loop_interceptors/mod.ts";
import type { TaskEvent } from "./task_events.ts";
import { SkillManager, type SkillManagerOptions } from "./skill_manager.ts";
import type { Tool } from "./tools/mod.ts";
import { Completer } from "@zypher/utils";

/**
 * Function that loads the system prompt for the agent.
 * This allows developers to implement custom prompt loading logic,
 * such as reading from files, fetching from APIs, or computing dynamically.
 */
export type SystemPromptLoader = () => Promise<string>;

/**
 * ZypherContext represents the workspace and filesystem environment where the agent operates.
 *
 * This is fundamentally different from {@link ZypherAgentConfig}:
 * - {@link ZypherContext} defines WHERE the agent operates (workspace/filesystem management)
 * - {@link ZypherAgentConfig} defines HOW the agent behaves (behavioral configuration)
 */
export interface ZypherContext {
  /** Working directory where the agent performs file operations and executes tasks */
  workingDirectory: string;
  /** Base zypher directory for all agent data storage (Defaults to ~/.zypher) */
  zypherDir: string;
  /** Workspace-specific data directory for isolated storage (Defaults to ~/.zypher/encoded_working_directory_path)
   * Used for message history, checkpoints, and other workspace-specific data */
  workspaceDataDir: string;
  /** Directory to cache file attachments (Defaults to ~/.zypher/cache/files) */
  fileAttachmentCacheDir: string;
  /** Global skills directory (Defaults to ~/.zypher/skills) */
  skillsDir: string;
  /** Unique identifier for tracking user-specific usage history */
  userId?: string;
}

export interface ZypherAgentConfig {
  /** Maximum number of agent loop iterations. Defaults to 25. */
  maxIterations: number;
  /** Maximum tokens per response. Defaults to 8192. */
  maxTokens: number;
  /** Maximum allowed time for a task in milliseconds before it's automatically cancelled. Default is 15 minutes (900000ms). Set to 0 to disable. */
  taskTimeoutMs: number;
  /** Skills configuration options */
  skills?: SkillManagerOptions;
}

export interface ZypherAgentOptions {
  /** Storage service for file attachments */
  storageService?: StorageService;
  /** Checkpoint manager for creating and managing git-based checkpoints */
  checkpointManager?: CheckpointManager;
  /** Tools to register with the agent. */
  tools?: Tool[];
  /**
   * Initial messages to seed the conversation history.
   * Useful for model switching - allows preserving conversation context
   * when creating a new agent with a different model.
   */
  initialMessages?: Message[];
  /**
   * Custom loop interceptors for post-inference processing.
   * `executeTools()` is always prepended automatically.
   * Your interceptors run after this built-in interceptor.
   */
  interceptors?: LoopInterceptor[];
  /** Override default implementations of core components */
  overrides?: {
    /** Function that loads the system prompt for the agent. Defaults to {@link getSystemPrompt}. */
    systemPromptLoader?: SystemPromptLoader;
    /** Custom MCP server manager. If not provided, a default instance will be created. */
    mcpServerManager?: McpServerManager;
    /** Custom loop interceptor manager. If not provided, a default instance will be created. */
    loopInterceptorManager?: LoopInterceptorManager;
    /** Custom Skill manager. If not provided, a default instance will be created. */
    skillManager?: SkillManager;
  };
  config?: Partial<ZypherAgentConfig>;
}

const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_MAX_ITERATIONS = 25;
const DEFAULT_TASK_TIMEOUT_MS = 900000;

export class ZypherAgent {
  readonly #modelProvider: ModelProvider;
  readonly #mcpServerManager: McpServerManager;
  readonly #loopInterceptorManager: LoopInterceptorManager;
  readonly #skillManager: SkillManager;
  readonly #checkpointManager?: CheckpointManager;
  readonly #systemPromptLoader: SystemPromptLoader;
  readonly #storageService?: StorageService;
  readonly #fileAttachmentManager?: FileAttachmentManager;

  readonly #context: ZypherContext;
  readonly #config: ZypherAgentConfig;

  #messages: Message[];
  #taskCompleter: Completer<void> | null = null;

  /**
   * Creates a new ZypherAgent instance
   *
   * @param context Workspace and filesystem environment configuration
   * @param model The model to use. Can be:
   *   - A model string (e.g., "claude-sonnet-4-5-20250929", "gpt-5.2")
   *   - A ModelProvider instance (for provider-specific options)
   * @example "claude-sonnet-4-5-20250929"
   * @example "gpt-5.2"
   * @example anthropic("claude-sonnet-4-5-20250929", { thinkingBudget: 10000 })
   * @param options Configuration options for the agent
   */
  constructor(
    context: ZypherContext,
    model: ModelProvider | string,
    options: ZypherAgentOptions = {},
  ) {
    this.#modelProvider = typeof model === "string"
      ? createModelProvider(model)
      : model;
    this.#context = context;

    // Initialize SkillManager
    this.#skillManager = options.overrides?.skillManager ??
      new SkillManager(context, options.config?.skills);

    // Create system prompt loader that includes Skills
    // Skills are automatically discovered within getSystemPrompt when skillManager is provided
    this.#systemPromptLoader = options.overrides?.systemPromptLoader ??
      (() =>
        getSystemPrompt(context.workingDirectory, {
          skillManager: this.#skillManager,
        }));

    this.#config = {
      maxIterations: options.config?.maxIterations ?? DEFAULT_MAX_ITERATIONS,
      maxTokens: options.config?.maxTokens ?? DEFAULT_MAX_TOKENS,
      taskTimeoutMs: options.config?.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS, // Default is 15 minutes
    };
    this.#messages = options.initialMessages
      ? [...options.initialMessages]
      : [];

    // Services and interceptors
    this.#mcpServerManager = options.overrides?.mcpServerManager ??
      new McpServerManager(context);
    this.#loopInterceptorManager = options.overrides?.loopInterceptorManager ??
      new LoopInterceptorManager([
        executeTools(this.#mcpServerManager),
        ...(options.interceptors ?? []),
      ]);

    this.#storageService = options.storageService;
    if (this.#storageService) {
      this.#fileAttachmentManager = new FileAttachmentManager(
        this.#storageService,
        context.fileAttachmentCacheDir,
      );
    }

    this.#checkpointManager = options.checkpointManager;

    // Register tools if provided
    if (options.tools) {
      for (const tool of options.tools) {
        this.#mcpServerManager.registerTool(tool);
      }
    }
  }

  /**
   * Get all messages from the agent's history
   * @returns Array of messages
   */
  get messages(): Message[] {
    return [...this.#messages];
  }

  /**
   * Get the configured agent configuration
   */
  get config(): ZypherAgentConfig {
    return this.#config;
  }

  /**
   * Check if a task is currently running
   */
  get isTaskRunning(): boolean {
    return this.#taskCompleter !== null;
  }

  /**
   * Get the MCP server manager for configuration
   */
  get mcp(): McpServerManager {
    return this.#mcpServerManager;
  }

  /**
   * Get the loop interceptor manager for configuration
   */
  get loopInterceptor(): LoopInterceptorManager {
    return this.#loopInterceptorManager;
  }

  /**
   * Get the Skill manager for configuration and Skill access
   */
  get skills(): SkillManager {
    return this.#skillManager;
  }

  /**
   * Get the underlying model provider
   */
  get llm(): ModelProvider {
    return this.#modelProvider;
  }

  /**
   * Get the system prompt loader function
   */
  get systemPromptLoader(): SystemPromptLoader {
    return this.#systemPromptLoader;
  }

  /**
   * Clear all messages from the agent's history
   */
  clearMessages(): void {
    this.#messages = [];
  }

  /**
   * Apply a checkpoint and update the message history
   * This will discard messages beyond the checkpoint
   *
   * @param checkpointId The ID of the checkpoint to apply
   */
  async applyCheckpoint(checkpointId: string): Promise<void> {
    if (!this.#checkpointManager) {
      throw new Error("Checkpoint manager not provided");
    }

    try {
      // Apply the checkpoint to the filesystem
      await this.#checkpointManager.applyCheckpoint(checkpointId);

      // Update message history to discard messages beyond the checkpoint
      const checkpointIndex = this.#messages.findIndex(
        (msg) => msg.checkpointId === checkpointId,
      );

      if (checkpointIndex !== -1) {
        // Keep messages up to but excluding the checkpoint message
        this.#messages = this.#messages.slice(0, checkpointIndex);
      }
    } catch (error) {
      throw new Error(`Failed to apply checkpoint ${checkpointId}.`, {
        cause: error,
      });
    }
  }

  /**
   * Run a task with real time progress updates
   *
   * This method provides real-time streaming of incremental content updates as they're generated,
   * allowing for character-by-character updates as Claude produces them. This enables
   * a more responsive user experience with immediate feedback.
   *
   * Streaming behavior:
   * - Content is streamed in real-time as it's generated
   * - Tool usage is streamed as tools are invoked
   * - Complete messages are delivered when available
   * - Errors and code fixes are handled automatically
   *
   * @param taskDescription The text description of the task to perform
   * @param fileAttachments Optional array of file attachments
   * @param options Additional options:
   *   - maxIterations: Maximum number of iterations to run (default: 25)
   *   - signal: AbortSignal for cancellation from the caller
   * @returns Array of messages after task completion, or return as is if cancelled
   * @throws {TaskConcurrencyError} If a task is already running
   */
  runTask(
    taskDescription: string,
    fileAttachments?: FileAttachment[],
    options?: {
      maxIterations?: number;
      signal?: AbortSignal;
    },
  ): Observable<TaskEvent> {
    // Create a single Subject for all task events
    const taskEventSubject = new Subject<TaskEvent>();

    // Start the internal task execution (fire-and-forget)
    this.#runTaskInternal(
      taskEventSubject,
      taskDescription,
      fileAttachments,
      options,
    );

    return taskEventSubject.asObservable();
  }

  async #runTaskInternal(
    taskEventSubject: Subject<TaskEvent>,
    taskDescription: string,
    fileAttachments?: FileAttachment[],
    options?: {
      maxIterations?: number;
      signal?: AbortSignal;
    },
  ): Promise<void> {
    // Check if a task is already running and set the completer atomically
    // This is safe because JavaScript is single-threaded
    if (this.#taskCompleter !== null) {
      throw new TaskConcurrencyError(
        "Cannot run multiple tasks concurrently. A task is already running.",
      );
    }
    this.#taskCompleter = new Completer<void>();

    const timeoutController = new AbortController();
    // Create a composite signal that aborts if either the caller's signal or our timeout signal aborts
    const mergedSignal = options?.signal
      ? AbortSignal.any([options.signal, timeoutController.signal])
      : timeoutController.signal;

    // Set up task timeout if enabled
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (this.#config.taskTimeoutMs > 0) {
      timeoutId = setTimeout(
        () => timeoutController.abort(),
        this.#config.taskTimeoutMs,
      );
    }

    // Pipe MCP tool events directly to task events (event shapes are compatible)
    const mcpSubscription = this.#mcpServerManager.events$.pipe(
      filter((e) =>
        e.type === "tool_use_pending_approval" ||
        e.type === "tool_use_approved" ||
        e.type === "tool_use_rejected" ||
        e.type === "tool_use_result" ||
        e.type === "tool_use_error"
      ),
    ).subscribe((event) => taskEventSubject.next(event));

    try {
      // Reload system prompt to get current custom rules from working directory
      const systemPrompt = await this.#systemPromptLoader();

      let iterations = 0;

      let checkpointId: string | undefined;
      let checkpoint: Checkpoint | undefined;
      if (this.#checkpointManager) {
        const checkpointName = `Before task: ${
          taskDescription.substring(0, 50)
        }${taskDescription.length > 50 ? "..." : ""}`;
        checkpointId = await this.#checkpointManager.createCheckpoint(
          checkpointName,
        );
        checkpoint = await this.#checkpointManager.getCheckpointDetails(
          checkpointId,
        );
      }

      const messageContent: ContentBlock[] = [
        ...(fileAttachments ?? []),
        {
          type: "text" as const,
          text: taskDescription,
        } satisfies ContentBlock,
      ];

      // Add user message with checkpoint reference
      const userMessage: Message = {
        role: "user",
        content: messageContent,
        checkpointId,
        checkpoint,
        timestamp: new Date(), // current timestamp
      };
      this.#messages.push(userMessage);
      taskEventSubject.next({ type: "message", message: userMessage });

      const toolCalls = Array.from(
        this.#mcpServerManager.tools.values(),
      );

      // Cache file attachments if enabled
      let cacheMap: FileAttachmentCacheMap | undefined;
      if (this.#fileAttachmentManager) {
        cacheMap = await this.#fileAttachmentManager
          .cacheMessageFileAttachments(
            this.#messages,
          );
      }

      const maxIterations = options?.maxIterations ??
        this.#config.maxIterations;

      // Cumulative token usage tracker (undefined until we receive usage data)
      let cumulativeUsage: TokenUsage | undefined;

      while (iterations < maxIterations) {
        // Check for abort signal early
        if (mergedSignal.aborted) {
          throw createAbortError("Task aborted");
        }

        const stream = this.#modelProvider.streamChat(
          {
            maxTokens: this.#config.maxTokens,
            system: systemPrompt,
            messages: this.#messages,
            tools: toolCalls,
            userId: this.#context.userId,
            signal: mergedSignal,
          },
          cacheMap,
        );

        const modelEvents = stream.events;
        for await (const event of eachValueFrom(modelEvents)) {
          // ModelEvents are now directly compatible with TaskEvents, so we can forward them as-is
          taskEventSubject.next(event);
        }

        const finalMessage = await stream.finalMessage();

        // Emit usage event if provider returned usage data
        if (finalMessage.usage) {
          cumulativeUsage = addTokenUsage(cumulativeUsage, finalMessage.usage);
          taskEventSubject.next({
            type: "usage",
            usage: finalMessage.usage,
            cumulativeUsage,
          });
        }

        // Create the assistant message using the complete content from finalMessage
        const assistantMessage: Message = {
          role: "assistant",
          content: finalMessage.content,
          timestamp: new Date(),
        };
        this.#messages.push(assistantMessage);

        // Check for cancellation
        if (mergedSignal.aborted) {
          throw createAbortError("Task aborted");
        }

        // Execute loop interceptors to determine if we should continue
        const responseText = finalMessage.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("");

        // Create a proxied message array that automatically emits events when modified
        const emittingMessages = createEmittingMessageArray(
          this.#messages,
          taskEventSubject,
        );

        const interceptorContext = {
          messages: emittingMessages,
          lastResponse: responseText,
          tools: toolCalls,
          zypherContext: this.#context,
          stopReason: finalMessage.stop_reason,
          signal: mergedSignal,
          eventSubject: taskEventSubject,
        };

        const interceptorResult = await this.#loopInterceptorManager.execute(
          interceptorContext,
        );

        if (interceptorResult.complete) {
          // All interceptors decided to complete, exit the loop
          break;
        }

        iterations++;
      }

      // Task completed successfully - emit completed event with final usage
      taskEventSubject.next({
        type: "completed",
        totalUsage: cumulativeUsage,
      });
    } catch (error) {
      if (isAbortError(error)) {
        // Abort/cancellation is an expected control flow, not an error.
        // Emit the cancellation event and let the finally block complete the subject normally.
        // This prevents consumers from treating intentional cancellation as a failure.
        taskEventSubject.next({
          type: "cancelled",
          reason: options?.signal?.aborted ? "user" : "timeout",
        });
        return;
      }

      // Only propagate unexpected errors to the subject
      taskEventSubject.error(error);
    } finally {
      // Unsubscribe from MCP server manager events
      mcpSubscription.unsubscribe();

      // Clear task timeout if it exists
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }

      // Complete the task event subject if it hasn't errored
      if (!taskEventSubject.closed) {
        taskEventSubject.complete();
      }

      // Resolve and clear the task completer
      this.#taskCompleter.resolve();
      this.#taskCompleter = null;
    }
  }

  /**
   * Wait for the task to complete
   * @returns A promise that resolves when the task is complete
   * @throws {Error} If no task is running
   */
  async wait(options?: { signal?: AbortSignal }): Promise<void> {
    if (!this.#taskCompleter) {
      throw new Error("Task is not running");
    }
    await this.#taskCompleter.wait(options);
  }
}
