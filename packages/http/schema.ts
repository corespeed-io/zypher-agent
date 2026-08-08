import z from "zod";
import type { HttpTaskEvent } from "./task_event.ts";
import type {
  McpWebSocketEvent,
  TaskWebSocketClientMessage as TaskWebSocketClientMessageType,
} from "@zypher/types";
import type { McpServerManagerEvent } from "@zypher/agent";

// Re-export shared types from @zypher/types
export type { McpWebSocketEvent, TaskWebSocketMessage } from "@zypher/types";

/**
 * Messages sent from the server to the client over the task WebSocket.
 * Uses the http-local HttpTaskEvent (with concrete HttpTaskEventId class).
 */
export type TaskWebSocketServerMessage = HttpTaskEvent;

export type TaskWebSocketClientMessage = TaskWebSocketClientMessageType;

// =============================================================================
// Common schemas
// =============================================================================

/** File attachment ID */
export type FileId = string;
export const FileId: z.ZodSchema<FileId> = z
  .string()
  .min(1, "File ID cannot be empty");

/** Task event ID in string format "task_<timestamp>_<sequence>" */
export const TaskEventId = z
  .string()
  .regex(/^task_\d+_\d+$/, "Expected format: task_<timestamp>_<sequence>");

// =============================================================================
// Task WebSocket schemas (/task/ws)
// =============================================================================

export const TaskWebSocketClientMessage: z.ZodSchema<
  TaskWebSocketClientMessageType
> = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("startTask"),
    task: z.string(),
    fileAttachments: z.array(FileId).optional(),
  }),
  z.object({
    action: z.literal("resumeTask"),
    lastEventId: TaskEventId.optional(),
  }),
  z.object({
    action: z.literal("cancelTask"),
  }),
  z.object({
    action: z.literal("approveTool"),
    approved: z.boolean(),
  }),
]);

/**
 * Sends a typed message over the task WebSocket connection.
 */
export function sendTaskWebSocketMessage(
  ws: { send: (data: string | ArrayBuffer) => void },
  message: TaskWebSocketServerMessage,
): void {
  ws.send(JSON.stringify(message));
}

// =============================================================================
// MCP WebSocket schemas (/mcp/ws)
// =============================================================================

/**
 * Transforms internal McpServerManagerEvent to frontend-friendly McpWebSocketEvent.
 *
 * Filters out events not relevant to the frontend and strips internal details
 * (e.g., removes the full McpClient object, keeping only pendingOAuthUrl).
 *
 * @returns The transformed event, or undefined if the event should be filtered out
 */
export function toMcpWebSocketEvent(
  event: McpServerManagerEvent,
): McpWebSocketEvent | undefined {
  if (event.type === "client_status_changed") {
    // Extract only the pendingOAuthUrl from the client object
    // to avoid exposing internal McpClient details to the frontend
    const { client, ...rest } = event;
    return {
      ...rest,
      pendingOAuthUrl: client.pendingOAuthUrl,
    };
  } else if (
    event.type === "server_added" ||
    event.type === "server_updated" ||
    event.type === "server_removed"
  ) {
    // These events can be passed through as-is
    return event;
  } else {
    // Filter out any other internal events not meant for the frontend
    return undefined;
  }
}
