# MCP examples

## Parallel Search

`parallel_search.ts` uses Zypher's `McpServerManager` to discover and execute
Parallel's `web_search` and `web_fetch` tools over Streamable HTTP. It prints
the server's text results, including source links and excerpts. No model
provider or LLM API key is needed for this programmatic example.

The [Parallel Search MCP](https://docs.parallel.ai/search/search-mcp) is free
and keyless for light use. This example sends no API key or OAuth credentials.
The anonymous service has rate limits; tool errors produce a nonzero exit
status.

From the repository root, with Deno installed:

```sh
deno install --frozen=true
deno run --allow-net=search.parallel.ai --allow-env --allow-read --allow-write examples/mcp/parallel_search.ts search "Deno permission system documentation"
deno run --allow-net=search.parallel.ai --allow-env --allow-read --allow-write examples/mcp/parallel_search.ts fetch https://docs.deno.com/runtime/fundamentals/security/
```

Network access is limited to the MCP host. Environment and read permissions are
needed by SDK dependencies; write access creates temporary Zypher context
directories. The example does not load `.env` files or use your saved Zypher
workspace. It closes the MCP connection and removes temporary state on
completion. Only running this example or explicitly adding its server
configuration enables Parallel. Existing SDK defaults and examples are
unchanged.

To make the same tools available in your own agent, reuse the exported
`parallelSearchServer` configuration:

```ts
import { createZypherAgent } from "@zypher/agent";
import { parallelSearchServer } from "./parallel_search.ts";

const agent = await createZypherAgent({
  model: "claude-sonnet-4-5-20250929",
  mcpServers: [parallelSearchServer],
});
```

Unlike the programmatic example, an agent task requires credentials for the
model you choose. Append the configuration to your existing `mcpServers` list to
retain other tools. Zypher names the tools `mcp__parallel-search__web_search`
and `mcp__parallel-search__web_fetch`. The configuration uses
`https://search.parallel.ai/mcp` and identifies the caller with the
`zypher-agent/parallel-search-example` User-Agent. Auth, transport fallback,
timeouts and cancellation remain managed by Zypher's MCP client.

Run the deterministic transport and agent-task tests without calling external
services:

```sh
deno test -A examples/mcp/parallel_search.integration.test.ts
```
