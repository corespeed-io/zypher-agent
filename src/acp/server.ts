/**
 * ACP Server Factory
 *
 * Provides a factory function to create an ACP-compatible server
 * that adapts ZypherAgent to the ACP protocol.
 */

import * as acp from "acp";
import { ACPProtocolAdapter, type AgentFactory } from "./adapter.ts";

/**
 * Interface for controlling the ACP server lifecycle.
 */
export interface ACPServer {
  /** Start the ACP server */
  start(): void;
  /** Stop the ACP server */
  stop(): void;
}

/**
 * Internal implementation of ACPServer.
 */
class ACPServerImpl implements ACPServer {
  #factory: AgentFactory;
  #connection: acp.AgentSideConnection | null = null;

  constructor(factory: AgentFactory) {
    this.#factory = factory;
  }

  start(): void {
    const input: ReadableStream<Uint8Array> = Deno.stdin.readable;
    const output: WritableStream<Uint8Array> = Deno.stdout.writable;
    const stream = acp.ndJsonStream(output, input);

    this.#connection = new acp.AgentSideConnection((conn) => {
      return new ACPProtocolAdapter(conn, this.#factory);
    }, stream);
  }

  stop(): void {
    // The ACP SDK closes the connection when the underlying stream ends.
    // This method is provided for API completeness.
    this.#connection = null;
  }
}

/**
 * Creates an ACP server that adapts ZypherAgent instances to the ACP protocol.
 *
 * The factory function is called for each new ACP session, allowing
 * session-specific agent configuration (working directory, MCP servers, etc.).
 *
 * @example Basic usage
 * ```typescript
 * import { createACPServer } from "@corespeed/zypher/acp";
 * import { createZypherAgent } from "@corespeed/zypher";
 * import { AnthropicModelProvider } from "@corespeed/zypher/llm";
 * import { createFileSystemTools } from "@corespeed/zypher/tools";
 *
 * const modelProvider = new AnthropicModelProvider({
 *   apiKey: Deno.env.get("ANTHROPIC_API_KEY")!,
 * });
 *
 * const server = acpStdioServer(async (cwd) => {
 *   return await createZypherAgent({
 *     modelProvider,
 *     tools: [...createFileSystemTools()],
 *     workingDirectory: cwd,
 *   });
 * });
 *
 * server.start();
 * ```
 *
 * @example Shared agent (not recommended for most use cases)
 * ```typescript
 * const sharedAgent = await createZypherAgent({ modelProvider, tools });
 * const server = createACPServer(async () => sharedAgent);
 * server.start();
 * ```
 *
 * The default model can be configured via the `ZYPHER_MODEL` environment variable.
 * If not set, defaults to `claude-sonnet-4-20250514`.
 *
 * @param factory - Function that creates a ZypherAgent for each session
 * @returns An ACPServer instance with start() and stop() methods
 */
export function acpStdioServer(factory: AgentFactory): ACPServer {
  return new ACPServerImpl(factory);
}
