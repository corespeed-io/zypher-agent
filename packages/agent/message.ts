// Re-export shared types from @zypher/types (single source of truth)
export type {
  Base64ImageSource,
  ContentBlock,
  FileAttachment,
  ImageBlock,
  Message,
  TextBlock,
  ThinkingBlock,
  ToolResultBlock,
  ToolUseBlock,
  UrlImageSource,
} from "@zypher/types";

// Import for local use in type annotations
import type { FileAttachment, Message } from "@zypher/types";

/**
 * Type guard to validate if an unknown value is a Message object.
 * Also handles converting string timestamps to Date objects.
 *
 * @param value - The value to check
 * @returns True if the value is a valid Message object
 */
export function isMessage(value: unknown): value is Message {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const hasRequiredProps = "role" in value && "content" in value &&
    "timestamp" in value;

  if (!hasRequiredProps) {
    return false;
  }

  // Convert timestamp string to Date object if needed
  if (typeof (value as Message).timestamp === "string") {
    (value as Message).timestamp = new Date((value as Message).timestamp);
  }

  return true;
}

export function isFileAttachment(value: unknown): value is FileAttachment {
  return typeof value === "object" && value !== null &&
    "type" in value && value.type === "file_attachment" &&
    "fileId" in value && typeof value.fileId === "string";
}
