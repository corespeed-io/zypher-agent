#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys

/**
 * Zypher Agent - ACP Server Example
 *
 * This example demonstrates how to create an ACP-compatible agent using Zypher Agent.
 * It uses the official ACP SDK and Deno's native stdin/stdout streams.
 *
 * Run with:
 *   deno run --allow-read --allow-write --allow-env --allow-net --allow-run examples/acp-deno-server.ts
 *
 * Or via deno task:
 *   deno task example:acp
 *
 * To use with Zed, configure in settings.json:
 * {
 *   "agent": {
 *     "profiles": {
 *       "zypher": {
 *         "type": "custom",
 *         "command": "deno",
 *         "args": ["run", "--allow-read", "--allow-write", "--allow-env", "--allow-net", "--allow-run", "--allow-sys", "/path/to/examples/acp-deno-server.ts"],
 *         "env": {
 *           "ANTHROPIC_API_KEY": "your-api-key"
 *         }
 *       }
 *     }
 *   }
 * }
 */

import { acpStdioServer } from "@zypher/acp/mod.ts";
import { createZypherAgent } from "@zypher/factory.ts";
import { AnthropicModelProvider } from "@zypher/llm/Anthropic.ts";
import type { Tool } from "@zypher/tools/mod.ts";

// Mock weather tool for testing
const GetWeatherTool: Tool = {
  name: "get_weather",
  description: "Get the current weather for a given location",
  parameters: {
    type: "object",
    properties: {
      location: {
        type: "string",
        description: "The city and country, e.g. 'Tokyo, Japan'",
      },
    },
    required: ["location"],
  },
  execute: async (params: { location: string }) => {
    // Mock weather data
    const weatherData: Record<string, { temp: number; condition: string }> = {
      "tokyo": { temp: 22, condition: "Sunny" },
      "london": { temp: 15, condition: "Cloudy" },
      "new york": { temp: 18, condition: "Partly Cloudy" },
      "beijing": { temp: 20, condition: "Hazy" },
      "shanghai": { temp: 24, condition: "Clear" },
    };

    const locationKey = params.location.toLowerCase().split(",")[0].trim();
    const weather = weatherData[locationKey] || {
      temp: 20,
      condition: "Unknown",
    };

    return await Promise.resolve({
      content: [{
        type: "text",
        text:
          `Weather in ${params.location}: ${weather.temp}°C, ${weather.condition}`,
      }],
    });
  },
};

// Check for API key
const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
if (!apiKey) {
  console.error("Error: ANTHROPIC_API_KEY environment variable is required");
  Deno.exit(1);
}

// Create the model provider
const modelProvider = new AnthropicModelProvider({ apiKey });

// Create the ACP server with the factory pattern
const server = acpStdioServer(async (cwd) => {
  return await createZypherAgent({
    modelProvider,
    tools: [
      GetWeatherTool,
    ],
    workingDirectory: cwd,
  });
});

server.start();
