/**
 * Example: Coding Agent
 *
 * Demonstrates file system tools and error detection interceptors.
 * This example creates a coding assistant with:
 * - All file system tools via createFileSystemTools()
 * - Terminal command execution
 * - Error detection interceptors (TypeScript, ESLint)
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY - (required) Your Anthropic API key
 *   ZYPHER_MODEL      - (optional) Model to use, defaults to "claude-sonnet-5-5"
 *
 * Run:
 *   deno run --env -A examples/coding.ts [workspace-path]
 *
 * Examples:
 *   deno run --env -A examples/coding.ts                    # Uses current directory
 *   deno run --env -A examples/coding.ts ./my-project       # Uses ./my-project
 */

import { createZypherAgent, errorDetector } from "@zypher/agent";
import { createFileSystemTools, RunTerminalCmdTool } from "@zypher/agent/tools";
import { runAgentInTerminal } from "@zypher/cli";

// Get workspace from CLI args or use current directory
const workspace = Deno.args[0] ?? Deno.cwd();

// Change to workspace directory
if (workspace !== Deno.cwd()) {
  Deno.chdir(workspace);
  console.log(`Working directory: ${Deno.cwd()}\n`);
}

const model = Deno.env.get("ZYPHER_MODEL") ?? "claude-sonnet-5-5";

console.log(`Using model: ${model}`);
console.log(`Workspace: ${Deno.cwd()}\n`);

const agent = await createZypherAgent({
  model,
  tools: [...createFileSystemTools(), RunTerminalCmdTool],
  interceptors: [
    // Run TypeScript type checking after each response
    errorDetector("deno", ["check", "."]),
    // Run linting after each response
    errorDetector("deno", ["lint"]),
  ],
});

await runAgentInTerminal(agent);
