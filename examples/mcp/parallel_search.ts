/**
 * Keyless web search and page extraction through Zypher's MCP server manager.
 * Run from the repository root; see README.md in this directory.
 */
import {
  createZypherContext,
  type McpServerEndpoint,
  McpServerManager,
} from "@zypher/agent";
import type { ToolResult } from "@zypher/agent/tools";

/** Opt-in remote configuration, also usable in createZypherAgent.mcpServers. */
export const parallelSearchServer: McpServerEndpoint = {
  id: "parallel-search",
  displayName: "Parallel Search",
  type: "remote",
  remote: {
    url: "https://search.parallel.ai/mcp",
    headers: { "User-Agent": "zypher-agent/parallel-search-example" },
  },
};

/** Execute one search or fetch, then release the connection and temporary state. */
export async function runParallelSearch(args: string[]): Promise<ToolResult> {
  const [command, ...values] = args;
  if (
    (command !== "search" && command !== "fetch") || values.length === 0 ||
    values.some((value) => !value.trim())
  ) {
    throw new Error(
      "Usage: parallel_search.ts search <query> | fetch <url>...",
    );
  }
  if (command === "fetch") {
    for (const value of values) {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("Fetch URLs must use HTTP or HTTPS");
      }
    }
  }

  // No dotenv, stored model keys, or persistent Zypher settings are needed.
  const temporaryDirectory = await Deno.makeTempDir({
    prefix: "zypher-search-",
  });
  let manager: McpServerManager | undefined;
  try {
    const context = await createZypherContext(temporaryDirectory, {
      zypherDir: temporaryDirectory,
    });
    manager = new McpServerManager(context);
    await manager.registerServer(parallelSearchServer);

    // Reuse one conversation identifier for this invocation's MCP requests.
    const session_id = crypto.randomUUID();
    const toolName = command === "search" ? "web_search" : "web_fetch";
    const input = command === "search"
      ? {
        objective: values.join(" "),
        search_queries: [values.join(" ")],
        session_id,
      }
      : { urls: values, session_id };
    return await manager.callTool(
      crypto.randomUUID(),
      `mcp__parallel-search__${toolName}`,
      input,
    );
  } finally {
    await manager?.dispose();
    await Deno.remove(temporaryDirectory, { recursive: true });
  }
}

if (import.meta.main) {
  try {
    const result = await runParallelSearch(Deno.args);
    if (typeof result === "string") {
      console.log(result);
    } else {
      for (const content of result.content) {
        if (content.type === "text") console.log(content.text);
      }
      if (result.isError) Deno.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exitCode = 1;
  }
}
