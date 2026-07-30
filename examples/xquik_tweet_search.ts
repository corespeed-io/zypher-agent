/**
 * Example: Xquik Tweet Search Tool
 *
 * Demonstrates a read-only custom tool that lets a Zypher agent search recent
 * public X posts through Xquik.
 *
 * Xquik is an independent third-party service. Not affiliated with X Corp. "Twitter" and "X" are trademarks of X Corp.
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY - (required) Anthropic API key for the default model
 *   XQUIK_API_KEY     - (required) Xquik API key
 *   ZYPHER_MODEL      - (optional) Model, defaults to "claude-sonnet-4-5-20250929"
 *
 * Run:
 *   ZYPHER_HOME=.zypher-example deno run \
 *     --allow-env \
 *     --allow-net=api.anthropic.com,xquik.com \
 *     --allow-read=.,.zypher-example \
 *     --allow-write=.zypher-example \
 *     examples/xquik_tweet_search.ts
 */

import { createZypherAgent } from "@zypher/agent";
import { createTool } from "@zypher/agent/tools";
import { runAgentInTerminal } from "@zypher/cli";
import { z } from "zod";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const XQUIK_SEARCH_URL = "https://xquik.com/api/v1/x/tweets/search";

interface PublicPost {
  id: string;
  content: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function toPublicPost(value: unknown): PublicPost {
  const record = isRecord(value) ? value : {};
  const authorRecord = isRecord(record.author) ? record.author : {};
  const id = asString(record.id ?? record.tweet_id);
  const rawAuthor = asString(
    record.author_username ?? record.username ?? authorRecord.username,
  );
  const author = /^[A-Za-z0-9_]{1,15}$/.test(rawAuthor) ? rawAuthor : "";
  const text = escapeBoundaryText(
    asString(record.text ?? record.full_text ?? record.content),
  );
  const safeId = /^\d+$/.test(id) ? id : "";
  const postUrl = author && safeId
    ? `https://x.com/${author}/status/${safeId}`
    : "";
  const label = author ? `@${author}: ` : "";
  const body = text || "No text returned.";
  const suffix = postUrl ? ` ${postUrl}` : "";

  return {
    id: safeId,
    content: [
      `<XQUIK_UNTRUSTED_X_CONTENT source="tweet" id="${safeId || "unknown"}">`,
      `${label}${body}${suffix}`,
      "</XQUIK_UNTRUSTED_X_CONTENT>",
    ].join("\n"),
  };
}

function escapeBoundaryText(value: string): string {
  return value.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
}

function formatPost(post: PublicPost, index: number): string {
  return `${index}.\n${post.content}`;
}

const searchXPostsTool = createTool({
  name: "search_x_posts",
  description: "Search recent public X posts through Xquik",
  schema: z.object({
    query: z.string().trim().min(1).describe("Search query"),
    limit: z.number().int().min(1).max(10).default(5).describe(
      "Maximum number of posts to return",
    ),
  }),
  outputSchema: z.object({
    query: z.string(),
    posts: z.array(
      z.object({
        id: z.string(),
        content: z.string().describe(
          "X-authored text wrapped in an untrusted-content boundary",
        ),
      }),
    ),
  }),
  async execute({ query, limit }, _ctx, options) {
    const apiKey = Deno.env.get("XQUIK_API_KEY");
    if (!apiKey) {
      throw new Error("Set XQUIK_API_KEY before using search_x_posts.");
    }

    const url = new URL(XQUIK_SEARCH_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("queryType", "Latest");

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-API-Key": apiKey,
      },
      signal: options?.signal,
    });
    if (!response.ok) {
      return {
        content: [{
          type: "text" as const,
          text: `Xquik request failed with HTTP ${response.status}.`,
        }],
        structuredContent: { query, posts: [] },
      };
    }

    const payload = await response.json() as { tweets?: unknown };
    const rawPosts = Array.isArray(payload.tweets) ? payload.tweets : [];
    const posts = rawPosts.map(toPublicPost);
    const text = posts.length > 0
      ? posts.map(formatPost).join("\n")
      : `No public posts found for "${query}".`;

    return {
      content: [{ type: "text" as const, text }],
      structuredContent: { query, posts },
    };
  },
});

const agent = await createZypherAgent({
  model: Deno.env.get("ZYPHER_MODEL") ?? DEFAULT_MODEL,
  tools: [searchXPostsTool],
});

await runAgentInTerminal(agent);
