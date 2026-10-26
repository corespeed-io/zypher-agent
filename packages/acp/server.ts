/**
 * ACP Server
 *
 * Runs a Zypher ACP agent over stdio.
 */

import * as acp from "acp";
import { Completer } from "@zypher/utils";
import { ZypherAcpAgent, type ZypherAgentBuilder } from "./zypher_acp_agent.ts";
export type {
  AcpClientConfig,
  ZypherAgentBuilder,
} from "./zypher_acp_agent.ts";

/**
 * Options for running an ACP server.
 */
export interface RunAcpServerOptions {
  /** Custom input stream, defaults to Deno.stdin.readable */
  input?: ReadableStream<Uint8Array>;
  /** Custom output stream, defaults to Deno.stdout.writable */
  output?: WritableStream<Uint8Array>;
  /** Signal to stop the server */
  signal?: AbortSignal;
}

/**
 * Runs a Zypher ACP server.
 *
 * @example Basic usage
 * ```typescript
 * import { runAcpServer } from "@zypher/acp";
 * import { createZypherAgent, createModelProvider } from "@zypher/agent";
 *
 * const modelProvider = createModelProvider("anthropic/claude-sonnet-5-5", { apiKey: "..." });
 *
 * await runAcpServer(async (clientConfig) => {
 *   return await createZypherAgent({
 *     model: modelProvider,
 *     tools: [...],
 *     workingDirectory: clientConfig.cwd,
 *     mcpServers: clientConfig.mcpServers,
 *   });
 * });
 * ```
 *
 * @example With abort signal
 * ```typescript
 * const controller = new AbortController();
 * setTimeout(() => controller.abort(), 60000);
 *
 * await runAcpServer(builder, { signal: controller.signal });
 * ```
 *
 * @param builder - Function that creates a ZypherAgent for each session
 * @param options - Optional configuration for streams and cancellation
 * @returns Promise that resolves when the connection closes
 */
export async function runAcpServer(
  builder: ZypherAgentBuilder,
  options?: RunAcpServerOptions,
): Promise<void> {
  const input = options?.input ?? Deno.stdin.readable;
  const output = options?.output ?? Deno.stdout.writable;
  const stream = acp.ndJsonStream(output, input);

  const connection = new acp.AgentSideConnection(
    (conn) => new ZypherAcpAgent(conn, builder),
    stream,
  );

  const abortCompleter = new Completer<void>();
  await Promise.race([
    connection.closed,
    abortCompleter.wait({ signal: options?.signal }),
  ]);
}
