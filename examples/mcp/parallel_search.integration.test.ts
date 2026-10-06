import assert from "node:assert/strict";
import {
  createZypherAgent,
  type FinalMessage,
  type ModelProvider,
  type StreamChatParams,
} from "@zypher/agent";
import { EMPTY } from "rxjs";
import { eachValueFrom } from "rxjs-for-await";
import { parallelSearchServer, runParallelSearch } from "./parallel_search.ts";

// Exercise the real manager, client, schema conversion and HTTP transport.
// Only the remote HTTP responses are fixtures; no external services are needed.
function installMcpFixture() {
  const originalFetch = globalThis.fetch;
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    assert.equal(request.url, "https://search.parallel.ai/mcp");
    assert.equal(
      request.headers.get("user-agent"),
      "zypher-agent/parallel-search-example",
    );
    assert.equal(request.headers.has("authorization"), false);
    assert.equal(request.headers.has("x-api-key"), false);
    if (request.method === "GET") return new Response(null, { status: 405 });
    if (request.method === "DELETE") return new Response(null, { status: 200 });
    const rpc = await request.json();
    let result: unknown;
    switch (rpc.method) {
      case "initialize":
        result = {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "search-fixture", version: "1.0.0" },
        };
        break;
      case "notifications/initialized":
        return new Response(null, { status: 202 });
      case "tools/list":
        result = {
          tools: [
            {
              name: "web_search",
              inputSchema: {
                type: "object",
                properties: {
                  objective: { type: "string" },
                  search_queries: { type: "array", items: { type: "string" } },
                  session_id: { type: "string" },
                },
                required: ["objective", "search_queries"],
              },
            },
            {
              name: "web_fetch",
              inputSchema: {
                type: "object",
                properties: {
                  urls: { type: "array", items: { type: "string" } },
                  session_id: { type: "string" },
                },
                required: ["urls"],
              },
            },
          ],
        };
        break;
      case "tools/call":
        calls.push(rpc.params);
        result = {
          content: [{
            type: "text",
            text:
              "Deno denies I/O by default. Source: https://docs.deno.com/runtime/fundamentals/security/",
          }],
          isError: rpc.params.arguments.objective === "fixture error",
        };
        break;
      default:
        throw new Error(`Unexpected MCP method: ${rpc.method}`);
    }
    return Response.json({ jsonrpc: "2.0", id: rpc.id, result });
  };
  return { calls, requests, restore: () => globalThis.fetch = originalFetch };
}

Deno.test("Parallel example loads opt-in config and executes search and fetch", async () => {
  const fixture = installMcpFixture();
  try {
    const search = await runParallelSearch(["search", "Deno", "permissions"]);
    assert.equal(typeof search, "object");
    assert.match(JSON.stringify(search), /Deno denies I\/O by default/);
    assert.deepEqual(fixture.calls[0].arguments.search_queries, [
      "Deno permissions",
    ]);
    assert.equal(fixture.calls[0].name, "web_search");
    assert.match(
      String(fixture.calls[0].arguments.session_id),
      /^[0-9a-f-]{36}$/,
    );
    const url = "https://docs.deno.com/runtime/fundamentals/security/";
    const fetch = await runParallelSearch(["fetch", url]);
    assert.match(JSON.stringify(fetch), /docs.deno.com/);
    assert.equal(fixture.calls[1].name, "web_fetch");
    assert.deepEqual(fixture.calls[1].arguments.urls, [url]);
    const failure = await runParallelSearch(["search", "fixture error"]);
    assert.equal(typeof failure !== "string" && failure.isError, true);
    assert.ok(fixture.requests.some((request) => request.method === "POST"));
  } finally {
    fixture.restore();
  }
});

Deno.test("Parallel example rejects invalid input before contacting the service", async () => {
  const fixture = installMcpFixture();
  try {
    for (
      const args of [[], ["search"], ["search", " "], ["unknown", "query"], [
        "fetch",
        "file:///tmp/x",
      ]]
    ) {
      await assert.rejects(() => runParallelSearch(args));
    }
    assert.equal(fixture.requests.length, 0);
  } finally {
    fixture.restore();
  }
});

Deno.test("Exported configuration works through agent factory and task tool execution", async () => {
  const fixture = installMcpFixture();
  const directory = await Deno.makeTempDir();
  let agent: Awaited<ReturnType<typeof createZypherAgent>> | undefined;
  let iterations = 0;
  // Deterministic provider verifies the model sees the discovered tool and then
  // receives its result. It does not replace any MCP layer or tool execution.
  const model: ModelProvider = {
    info: { name: "fixture", version: "1", capabilities: ["tool_calling"] },
    modelId: "fixture",
    streamChat(params: StreamChatParams) {
      const name = "mcp__parallel-search__web_search";
      assert.ok(params.tools?.some((tool) => tool.name === name));
      const result = params.messages.flatMap((message) => message.content)
        .find((block) => block.type === "tool_result");
      if (iterations++ > 0) {
        assert.ok(result && result.type === "tool_result" && result.success);
      }
      const message: FinalMessage = {
        role: "assistant",
        timestamp: new Date(),
        stop_reason: result ? "end_turn" : "tool_use",
        content: result && result.type === "tool_result" ? result.content : [{
          type: "tool_use",
          toolUseId: "search-task",
          name,
          input: {
            objective: "Deno permissions",
            search_queries: ["Deno permissions"],
          },
        }],
      };
      return { events: EMPTY, finalMessage: () => Promise.resolve(message) };
    },
  };
  try {
    agent = await createZypherAgent({
      model,
      workingDirectory: directory,
      context: { zypherDir: directory },
      mcpServers: [parallelSearchServer],
    });
    assert.deepEqual(
      agent.mcp.servers.get("parallel-search")?.server,
      parallelSearchServer,
    );
    assert.equal(agent.mcp.servers.size, 1);
    const events = [];
    for await (
      const event of eachValueFrom(agent.runTask("Explain Deno permissions"))
    ) {
      events.push(event);
    }
    assert.ok(events.some((event) => event.type === "message"));
    assert.equal(iterations, 2);
    assert.equal(fixture.calls.length, 1);
    assert.match(
      JSON.stringify(agent.messages.at(-1)),
      /Deno denies I\/O by default/,
    );
  } finally {
    await agent?.mcp.dispose();
    await Deno.remove(directory, { recursive: true });
    fixture.restore();
  }
});
