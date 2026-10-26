/**
 * Example: Programmatic Tool Calling
 *
 * Demonstrates programmatic tool calling where the LLM can use
 * execute_code to call tools like tools.get_weather() and process
 * the results efficiently.
 *
 * Also demonstrates tool approval handling - requiring user confirmation
 * before executing `execute_code` tool.
 *
 * Run:
 *   deno run --env --allow-read --allow-net --allow-env --allow-sys ./ptc.ts
 */

import {
  createZypherContext,
  McpServerManager,
  ZypherAgent,
} from "@zypher/agent";
import { createExecuteCodeTool, createTool } from "@zypher/agent/tools";
import { z } from "zod";
import { eachValueFrom } from "rxjs-for-await";
import { TextLineStream } from "@std/streams/text-line-stream";
import chalk from "chalk";

async function prompt(message: string): Promise<string> {
  console.log(message);
  const lines = Deno.stdin.readable
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream());
  try {
    for await (const line of lines) {
      return line;
    }
    return "";
  } finally {
    await lines.cancel();
  }
}

const DEFAULT_MODEL = "claude-sonnet-5-5";

// Create a simple weather tool
const getWeather = createTool({
  name: "get_weather",
  description: "Get the current weather for a city",
  schema: z.object({
    city: z.string().describe("City name"),
  }),
  // Note: outputSchema is optional but highly RECOMMENDED for tools used with PTC.
  // It documents the structure of result.structuredContent, which helps the agent to
  // generate correct code for accessing and manipulating tool results.
  outputSchema: z.object({
    city: z.string().describe("The city name"),
    temperature: z.number().describe("Temperature in Celsius"),
    condition: z.string().describe(
      "Weather condition (e.g., Sunny, Cloudy, Rainy)",
    ),
    unit: z.literal("celsius").describe("Temperature unit"),
  }),
  execute: ({ city }) => {
    // Mock weather data for European cities
    const MOCK_WEATHER: Record<string, { temp: number; condition: string }> = {
      paris: { temp: 8, condition: "Cloudy" },
      london: { temp: 6, condition: "Rainy" },
      berlin: { temp: 3, condition: "Snowy" },
      rome: { temp: 14, condition: "Sunny" },
      madrid: { temp: 12, condition: "Partly Cloudy" },
      amsterdam: { temp: 5, condition: "Windy" },
      vienna: { temp: 4, condition: "Foggy" },
      prague: { temp: 2, condition: "Cloudy" },
      barcelona: { temp: 16, condition: "Sunny" },
      lisbon: { temp: 18, condition: "Clear" },
    };
    const key = city.toLowerCase();
    const data = MOCK_WEATHER[key];
    if (!data) {
      throw new Error(`Weather data not available for ${city}`);
    }
    return Promise.resolve(
      {
        content: [{
          type: "text",
          text:
            `The weather in ${city} is ${data.condition} with a temperature of ${data.temp}°C`,
        }],
        structuredContent: {
          city,
          temperature: data.temp,
          condition: data.condition,
          unit: "celsius",
        },
      },
    );
  },
});

// Create context and MCP server manager with tool approval handler
const context = await createZypherContext(Deno.cwd());
const mcpServerManager = new McpServerManager(context, {
  toolApprovalHandler: async (toolName, input) => {
    if (toolName !== "execute_code") {
      return true;
    }

    const { code } = input as { code: string };
    console.log(`\n🤖 Zypher Agent wants to run the following code:\n`);
    console.log(chalk.dim("```typescript"));
    console.log(chalk.cyan(code));
    console.log(chalk.dim("```\n"));

    const response = await prompt("Run the code above? (y/N): ");
    const approved = response.toLowerCase() === "y";
    console.log(approved ? "✅ Approved\n" : "❌ Rejected\n");
    return approved;
  },
});

// Register tools
mcpServerManager.registerTool(getWeather);
mcpServerManager.registerTool(createExecuteCodeTool(mcpServerManager));

// Create the agent with the custom MCP server manager
const agent = new ZypherAgent(
  context,
  Deno.env.get("ZYPHER_MODEL") ?? DEFAULT_MODEL,
  {
    overrides: {
      mcpServerManager,
    },
  },
);

const events$ = agent.runTask(
  `In the following cities:
- paris
- london
- berlin
- rome
- madrid
- amsterdam
- vienna
- prague
- barcelona
- lisbon

get two cities with the most similar weather and the city with the highest temperature`,
);

const textEncoder = new TextEncoder();
let isFirstTextChunk = true;

try {
  for await (const event of eachValueFrom(events$)) {
    if (event.type === "text") {
      if (isFirstTextChunk) {
        await Deno.stdout.write(textEncoder.encode("🤖 "));
        isFirstTextChunk = false;
      }
      await Deno.stdout.write(textEncoder.encode(event.content));
    } else {
      isFirstTextChunk = true;

      if (event.type === "tool_use") {
        console.log(`\n🔧 Using tool: ${event.toolName}`);
      } else if (event.type === "tool_use_result") {
        console.log(`📋 Tool result: ${event.toolName} (${event.toolUseId})`);
        console.log(event.result);
        console.log();
      }
    }
  }

  console.log("\n");
  console.log(chalk.green("✅ Task completed.\n"));
  Deno.exit(0);
} catch (error) {
  console.error(error);
  Deno.exit(1);
}
