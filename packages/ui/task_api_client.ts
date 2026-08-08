import type { Message } from "@zypher/types";
import type {
  TaskWebSocketClientMessage,
  TaskWebSocketMessage,
  TaskWebSocketServerMessage,
} from "@zypher/types";
import type { Observable } from "rxjs";
import { webSocket, type WebSocketSubject } from "rxjs/webSocket";
import { toWebSocketUrl } from "./utils.ts";

const DEFAULT_WS_PROTOCOL = "zypher.v1";

// =========================== TASK CONNECTION ===========================

/**
 * A connection to an active agent task over WebSocket.
 *
 * Provides an observable of task events and typed methods
 * for sending client messages (cancel, approve tool, close).
 */
export interface TaskConnection {
  /** Observable stream of task events from the server. */
  events$: Observable<TaskWebSocketServerMessage>;
  /** Cancel the currently running task. */
  cancelTask(): void;
  /** Send a tool approval response. */
  approveTool(approved: boolean): void;
  /** Close the underlying WebSocket connection. */
  close(): void;
}

/**
 * Options for creating a ZypherApiClient
 */
export interface TaskApiClientOptions {
  /** Base URL of the Zypher HTTP server (e.g. "http://localhost:8080"). */
  baseUrl: string;
  /** HTTP headers for REST endpoints. Static or async. */
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>);
  /** WebSocket sub-protocols. Static or async. Defaults to [DEFAULT_WS_PROTOCOL].
   *  If omitted and `headers` contains Authorization: Bearer, auto-derives ws-bearer-TOKEN. */
  protocols?: string[] | (() => string[] | Promise<string[]>);
}

/**
 * Options for starting a task
 */
export interface StartTaskOptions {
  fileAttachments?: string[];
}

export class TaskApiClient {
  readonly #options: TaskApiClientOptions;

  constructor(options: TaskApiClientOptions) {
    this.#options = options;
  }

  /** The base URL of the Zypher HTTP server. */
  get baseUrl(): string {
    return this.#options.baseUrl;
  }

  async #resolveHeaders(): Promise<Record<string, string>> {
    const { headers } = this.#options;
    if (!headers) return {};
    return typeof headers === "function" ? await headers() : headers;
  }

  async #resolveProtocols(): Promise<string[]> {
    const { protocols } = this.#options;
    if (protocols) {
      return typeof protocols === "function" ? await protocols() : protocols;
    }
    // Auto-derive from Authorization: Bearer header
    const headers = await this.#resolveHeaders();
    const auth = headers["Authorization"] ?? headers["authorization"];
    if (auth) {
      const match = auth.match(/^Bearer\s+(.+)$/);
      if (match) {
        return [DEFAULT_WS_PROTOCOL, `ws-bearer-${match[1]}`];
      }
    }
    return [DEFAULT_WS_PROTOCOL];
  }

  /**
   * Wrap a WebSocketSubject into a TaskConnection.
   *
   * Sends `initialMessage` on creation (queued until socket opens).
   * Close code 1000 from the server is treated as normal completion;
   * any other server-initiated close surfaces as an error on `events$`.
   */
  #createTaskConnection(
    subject: WebSocketSubject<TaskWebSocketMessage>,
    initialMessage: TaskWebSocketClientMessage,
  ): TaskConnection {
    // subject.next() queues messages until the socket opens, then flushes.
    subject.next(initialMessage);

    const sendMessage = (message: TaskWebSocketClientMessage): void => {
      subject.next(message);
    };

    return {
      events$: subject as Observable<TaskWebSocketServerMessage>,
      cancelTask: () => sendMessage({ action: "cancelTask" }),
      approveTool: (approved: boolean) =>
        sendMessage({ action: "approveTool", approved }),
      close: () => subject.complete(),
    };
  }

  /**
   * Start a task and return a TaskConnection for event streaming and control.
   */
  async startTask(
    taskPrompt: string,
    options?: StartTaskOptions,
  ): Promise<TaskConnection> {
    const protocols = await this.#resolveProtocols();
    const wsUrl = toWebSocketUrl(`${this.#options.baseUrl}/task/ws`);

    const subject = webSocket<TaskWebSocketMessage>({
      url: wsUrl,
      protocol: protocols,
      openObserver: {
        next: () => console.log("WebSocket connection opened"),
      },
      closeObserver: {
        next: (event: CloseEvent) => {
          console.log(
            `WebSocket connection closed: ${event.code} ${event.reason ?? ""}`,
          );
        },
      },
      serializer: (msg) => JSON.stringify(msg),
      deserializer: (msg) => JSON.parse(msg.data),
    });

    return this.#createTaskConnection(subject, {
      action: "startTask",
      task: taskPrompt,
      fileAttachments: options?.fileAttachments,
    });
  }

  /**
   * Resume a task and return a TaskConnection for event streaming and control.
   */
  async resumeTask(lastEventId?: string): Promise<TaskConnection> {
    const protocols = await this.#resolveProtocols();
    const wsUrl = toWebSocketUrl(`${this.#options.baseUrl}/task/ws`);

    const subject = webSocket<TaskWebSocketMessage>({
      url: wsUrl,
      protocol: protocols,
      openObserver: {
        next: () => console.log("WebSocket connection opened for resume"),
      },
      closeObserver: {
        next: (event: CloseEvent) => {
          console.log(
            `WebSocket connection closed: ${event.code} ${event.reason ?? ""}`,
          );
        },
      },
      serializer: (msg) => JSON.stringify(msg),
      deserializer: (msg) => JSON.parse(msg.data),
    });

    return this.#createTaskConnection(subject, {
      action: "resumeTask",
      lastEventId,
    });
  }

  /**
   * Fetch all messages from the agent
   */
  async getMessages(): Promise<Message[]> {
    const headers = await this.#resolveHeaders();
    const response = await fetch(`${this.#options.baseUrl}/messages`, {
      headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to load messages: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Clear all message history
   */
  async clearMessages(): Promise<void> {
    const headers = await this.#resolveHeaders();
    const response = await fetch(`${this.#options.baseUrl}/messages`, {
      method: "DELETE",
      headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to clear messages: ${response.status}`);
    }
  }

  /**
   * Apply a checkpoint to restore previous state
   */
  async applyCheckpoint(checkpointId: string): Promise<void> {
    const headers = await this.#resolveHeaders();
    const response = await fetch(
      `${this.#options.baseUrl}/checkpoints/${checkpointId}/apply`,
      {
        method: "POST",
        headers,
      },
    );

    if (!response.ok) {
      throw new Error("Failed to apply checkpoint");
    }
  }
}
