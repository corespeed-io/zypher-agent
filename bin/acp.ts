#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net --allow-run

/**
 * ACP Mode Entry Point
 *
 * This script starts Zypher Agent in ACP (Agent Client Protocol) mode,
 * allowing it to be used by ACP-compatible clients like Zed.
 *
 * Usage:
 *   deno run --allow-read --allow-write --allow-env --allow-net --allow-run bin/acp.ts
 *
 * Or via deno task:
 *   deno task acp
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY - API key for Anthropic (required for Anthropic provider)
 *   OPENAI_API_KEY - API key for OpenAI (required for OpenAI provider)
 *   ZYPHER_ACP_MODEL - Default model to use (optional)
 *   ZYPHER_ACP_PROVIDER - Model provider: "anthropic" or "openai" (default: "anthropic")
 */

import { parseArgs } from "@std/cli";
import { AnthropicModelProvider } from "../src/llm/Anthropic.ts";
import { OpenAIModelProvider } from "../src/llm/OpenAI.ts";
import type { ModelProvider } from "../src/llm/mod.ts";
import {
  AcpAgentServer,
  type JsonRpcMessage,
} from "../src/acp/mod.ts";

// Parse command line arguments
const args = parseArgs(Deno.args, {
  string: ["model", "provider"],
  boolean: ["help", "version"],
  default: {
    provider: Deno.env.get("ZYPHER_ACP_PROVIDER") ?? "anthropic",
    model: Deno.env.get("ZYPHER_ACP_MODEL"),
  },
});

if (args.help) {
  console.log(`
Zypher Agent - ACP Mode

Start Zypher Agent as an ACP-compatible agent for use with clients like Zed.

Usage:
  deno task acp [options]

Options:
  --provider <name>   Model provider: "anthropic" or "openai" (default: anthropic)
  --model <name>      Default model to use
  --help              Show this help message
  --version           Show version

Environment Variables:
  ANTHROPIC_API_KEY   API key for Anthropic
  OPENAI_API_KEY      API key for OpenAI
  ZYPHER_ACP_MODEL    Default model (can also use --model)
  ZYPHER_ACP_PROVIDER Model provider (can also use --provider)

Examples:
  # Start with Anthropic (default)
  ANTHROPIC_API_KEY=your-key deno task acp

  # Start with OpenAI
  OPENAI_API_KEY=your-key deno task acp --provider openai

  # Start with specific model
  ANTHROPIC_API_KEY=your-key deno task acp --model claude-sonnet-4-20250514
`);
  Deno.exit(0);
}

if (args.version) {
  console.log("Zypher Agent ACP Mode v0.1.0");
  Deno.exit(0);
}

// Create model provider based on configuration
function createModelProvider(): ModelProvider {
  const provider = args.provider?.toLowerCase();

  if (provider === "openai") {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      console.error("Error: OPENAI_API_KEY environment variable is required");
      Deno.exit(1);
    }
    return new OpenAIModelProvider({ apiKey });
  }

  // Default to Anthropic
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is required");
    Deno.exit(1);
  }
  return new AnthropicModelProvider({ apiKey });
}

// NDJSON encoder/decoder
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Parse NDJSON messages from a byte stream
 */
async function* parseNdJson(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<JsonRpcMessage> {
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      // Process any remaining content in buffer
      if (buffer.trim()) {
        try {
          yield JSON.parse(buffer.trim()) as JsonRpcMessage;
        } catch {
          console.error("[ACP] Failed to parse final message:", buffer);
        }
      }
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    // Process complete lines
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        try {
          yield JSON.parse(trimmed) as JsonRpcMessage;
        } catch {
          console.error("[ACP] Failed to parse message:", trimmed);
        }
      }
    }
  }
}

/**
 * Write a JSON-RPC message as NDJSON
 */
function writeMessage(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  message: JsonRpcMessage,
): Promise<void> {
  const json = JSON.stringify(message) + "\n";
  return writer.write(encoder.encode(json));
}

// Main entry point
async function main(): Promise<void> {
  // Create model provider
  const modelProvider = createModelProvider();

  // Get default model
  const defaultModel = args.model ?? (
    args.provider === "openai" ? "gpt-4o" : "claude-sonnet-4-20250514"
  );

  // Create ACP server
  const server = new AcpAgentServer({
    modelProvider,
    defaultModel,
    agentInfo: {
      name: "zypher-agent",
      version: "0.1.0",
      title: "Zypher Agent",
    },
  });

  // Set up stdin/stdout communication
  const stdinReader = Deno.stdin.readable.getReader();
  const stdoutWriter = Deno.stdout.writable.getWriter();

  // Set up message sender
  server.setSendMessage((message) => {
    writeMessage(stdoutWriter, message);
  });

  // Process incoming messages
  try {
    for await (const message of parseNdJson(stdinReader)) {
      await server.handleMessage(message);
    }
  } catch (error) {
    if (error instanceof Error && error.name !== "Interrupted") {
      console.error("[ACP] Error processing messages:", error);
    }
  } finally {
    stdinReader.releaseLock();
    stdoutWriter.releaseLock();
  }
}

// Run main
main().catch((error) => {
  console.error("[ACP] Fatal error:", error);
  Deno.exit(1);
});
