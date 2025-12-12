# Zypher Agent

**Production-ready AI agents that live in your applications**

[![Build](https://github.com/CoreSpeed-io/zypher-agent/actions/workflows/build.yml/badge.svg)](https://github.com/CoreSpeed-io/zypher-agent/actions/workflows/build.yml)
[![JSR](https://jsr.io/badges/@corespeed/zypher)](https://jsr.io/badges/@corespeed/zypher)

## Features

- **Agent, Not Workflow**: Reactive loop where the agent dynamically decides
  next steps based on LLM reasoning.
- **Git-Based Checkpoints**: Track, review, and revert agent changes with
  built-in checkpoint management
- **Extensible Tool System**: Built-in tools for file operations, search, and
  terminal commands with support for custom tools
- **Model Context Protocol (MCP)**: Native support for MCP servers with OAuth
  authentication
- **Multi-Provider Support**: Works with Anthropic Claude and OpenAI GPT models
  through a unified interface
- **Loop Interceptor System**: Customize agent behavior with extensible
  post-inference interceptors
- **Production-Ready**: Configurable timeouts, concurrency protection, and
  comprehensive error handling

## Quick Start

### Installation

> [!NOTE]
> Support for npm coming soon.

#### Using JSR

```bash
deno add jsr:@corespeed/zypher
```

### SDK Usage

```typescript
import { AnthropicModelProvider, createZypherAgent } from "@corespeed/zypher";
import { createFileSystemTools } from "@corespeed/zypher/tools";
import { eachValueFrom } from "rxjs-for-await";

const agent = await createZypherAgent({
  modelProvider: new AnthropicModelProvider({
    apiKey: Deno.env.get("ANTHROPIC_API_KEY")!,
  }),
  tools: [...createFileSystemTools()],
  mcpServers: ["@modelcontextprotocol/sequentialthinking-server"],
});

// Run task with streaming
const taskEvents = agent.runTask(
  "Implement authentication middleware",
  "claude-sonnet-4-20250514",
);

for await (const event of eachValueFrom(taskEvents)) {
  console.log(event);
}
```

See our [documentation](https://zypher.corespeed.io/docs) for full usage
examples and API reference.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE.md](LICENSE.md) for
details.

## Resources

- [Documentation](https://zypher.corespeed.io/docs) and
  [API Reference](https://jsr.io/@corespeed/zypher/doc)
- [Issue Tracker](https://github.com/CoreSpeed-io/zypher-agent/issues)
- [Model Context Protocol](https://modelcontextprotocol.io/)

---

Built with ♥️ by [CoreSpeed](https://corespeed.io)

```typescript
/**
 * Deno-compatible ACP Agent Example
 *
 * This example demonstrates how to create an ACP agent that runs with Deno.
 * It uses Deno's native stdin/stdout streams instead of Node.js streams.
 *
 * Prerequisites:
 *   npm run build  # Build the TypeScript SDK first
 *
 * Run with:
 *   deno run --allow-read --allow-write examples/acp-deno-agent.ts
 *
 * The deno.json in this directory provides the import map to resolve
 * the "zod" peer dependency.
 *
 * To use with Zed, configure in settings:
 * {
 *   "agent_servers": {
 *     "Deno Example Agent": {
 *       "command": "deno",
 *       "args": ["run", "--allow-read", "--allow-write", "/path/to/deno-agent.ts"]
 *     }
 *   }
 * }
 */
const input: ReadableStream<Uint8Array> = Deno.stdin.readable;
const output: WritableStream<Uint8Array> = Deno.stdout.writable;

const stream = acp.ndJsonStream(output, input);
new acp.AgentSideConnection((conn) => {
  return createZypherAgent({
    modelProvider: new AnthropicModelProvider({
      apiKey: Deno.env.get("ANTHROPIC_API_KEY")!,
    }),
    tools: [...createFileSystemTools()],
    mcpServers: ["@modelcontextprotocol/sequentialthinking-server"],
    acpConnection: conn,
  });
}, stream);
`
```
