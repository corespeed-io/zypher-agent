/**
 * ACP/MCP Content Block Converter
 *
 * Converts ACP ContentBlock[] to ZypherAgent prompt format.
 * Follows MCP resource specification for consistent handling.
 *
 * Note: Content block `annotations` are intentionally ignored as ZypherAgent
 * does not currently use display hints or audience targeting metadata.
 */

import type { ContentBlock as AcpContentBlock } from "acp";
import type { ImageBlock } from "../message.ts";

/** Supported image MIME types (matches Anthropic API) */
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

/** Result of converting ACP content blocks */
export interface PromptContent {
  text: string;
  images: ImageBlock[];
}

/**
 * Converts ACP content blocks to ZypherAgent prompt format.
 */
export function convertPromptContent(blocks: AcpContentBlock[]): PromptContent {
  const parts: string[] = [];
  const images: ImageBlock[] = [];

  for (const block of blocks) {
    const result = convertBlock(block);
    if (result.text) parts.push(result.text);
    if (result.image) images.push(result.image);
  }

  return { text: parts.join("\n\n"), images };
}

function convertBlock(
  block: AcpContentBlock,
): { text: string; image?: ImageBlock } {
  switch (block.type) {
    case "text":
      return { text: block.text };

    case "image":
      return convertImage(block);

    case "resource":
      return convertResource(block.resource);

    case "resource_link":
      return { text: formatResourceLink(block) };

    case "audio":
      // Audio transcription not supported - include metadata for context
      return { text: `[Audio: ${block.mimeType}, not transcribed]` };

    default:
      // Unknown content type - preserve type info for debugging
      return {
        text: `[Unsupported content: ${(block as { type: string }).type}]`,
      };
  }
}

function convertImage(block: {
  data: string;
  mimeType: string;
  uri?: string | null;
}): { text: string; image?: ImageBlock } {
  const { data, mimeType, uri } = block;

  if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) {
    const label = uri ? getFilename(uri) : mimeType;
    return { text: `[Image: unsupported format ${label}]` };
  }

  const label = uri ? getFilename(uri) : "attached";
  return {
    text: `[Image: ${label}]`,
    image: {
      type: "image",
      source: { type: "base64", data, mediaType: mimeType },
    },
  };
}

function convertResource(resource: {
  uri: string;
  mimeType?: string | null;
  text?: string;
  blob?: string;
}): { text: string; image?: ImageBlock } {
  const { uri, text, blob } = resource;

  // Text resource
  if (text !== undefined) {
    const mimeType = resource.mimeType ?? "text/plain";
    return {
      text: `<resource uri="${uri}" type="${mimeType}">\n${text}\n</resource>`,
    };
  }

  // Blob resource
  if (blob !== undefined) {
    const mimeType = resource.mimeType ?? "application/octet-stream";
    if (SUPPORTED_IMAGE_TYPES.has(mimeType)) {
      return {
        text: `[Image: ${getFilename(uri)}]`,
        image: {
          type: "image",
          source: { type: "base64", data: blob, mediaType: mimeType },
        },
      };
    }
    return { text: `[Binary: ${getFilename(uri)} (${mimeType})]` };
  }

  return { text: `[Resource: ${uri}]` };
}

function formatResourceLink(block: {
  uri: string;
  name: string;
  mimeType?: string | null;
  title?: string | null;
  description?: string | null;
  size?: number | bigint | null;
}): string {
  const lines = [`[File: ${block.title ?? block.name}]`, `URI: ${block.uri}`];
  if (block.mimeType) lines.push(`Type: ${block.mimeType}`);
  if (block.description) lines.push(`Description: ${block.description}`);
  if (block.size != null) lines.push(`Size: ${formatBytes(block.size)}`);
  return lines.join("\n");
}

function formatBytes(bytes: number | bigint): string {
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function getFilename(uri: string): string {
  return uri.split("/").pop() ?? "file";
}
