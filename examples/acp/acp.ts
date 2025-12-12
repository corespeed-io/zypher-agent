#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys

/**
 * Example: ACP Server
 *
 * Demonstrates how to create an ACP-compatible agent using Zypher Agent.
 * Uses the official ACP SDK and Deno's native stdin/stdout streams.
 *
 * Run:
 *   deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys ./acp.ts
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
 *         "args": ["run", "--allow-read", "--allow-write", "--allow-env", "--allow-net", "--allow-run", "--allow-sys", "/path/to/examples/acp/acp.ts"],
 *         "env": {
 *           "ANTHROPIC_API_KEY": "your-api-key"
 *         }
 *       }
 *     }
 *   }
 * }
 */

import "@std/dotenv/load";
import { AnthropicModelProvider, createZypherAgent } from "@corespeed/zypher";
import { acpStdioServer } from "@corespeed/zypher/acp";
import { createTool } from "@corespeed/zypher/tools";
import { z } from "zod";

// Check for API key
const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
if (!apiKey) {
  console.error("Error: Set ANTHROPIC_API_KEY environment variable");
  Deno.exit(1);
}

// Create a weather tool using createTool with Zod schema
const getWeather = createTool({
  name: "get_weather",
  description: "Get the current weather for a city",
  schema: z.object({
    city: z.string().describe("The city name, e.g. 'Tokyo'"),
  }),
  // outputSchema documents the structure of result.structuredContent
  outputSchema: z.object({
    city: z.string().describe("The city name"),
    temperature: z.number().describe("Temperature in Celsius"),
    condition: z.string().describe("Weather condition (e.g., Sunny, Cloudy, Rainy)"),
    unit: z.literal("celsius").describe("Temperature unit"),
  }),
  execute: ({ city }) => {
    // Mock weather data for various cities
    const MOCK_WEATHER: Record<string, { temp: number; condition: string }> = {
      tokyo: { temp: 22, condition: "Sunny" },
      london: { temp: 15, condition: "Cloudy" },
      "new york": { temp: 18, condition: "Partly Cloudy" },
      beijing: { temp: 20, condition: "Hazy" },
      shanghai: { temp: 24, condition: "Clear" },
      paris: { temp: 8, condition: "Cloudy" },
      berlin: { temp: 3, condition: "Snowy" },
      rome: { temp: 14, condition: "Sunny" },
      madrid: { temp: 12, condition: "Partly Cloudy" },
      sydney: { temp: 28, condition: "Hot" },
    };

    const key = city.toLowerCase();
    const data = MOCK_WEATHER[key];
    if (!data) {
      throw new Error(`Weather data not available for ${city}`);
    }

    return Promise.resolve({
      content: [{
        type: "text",
        text: `The weather in ${city} is ${data.condition} with a temperature of ${data.temp}°C`,
      }],
      structuredContent: {
        city,
        temperature: data.temp,
        condition: data.condition,
        unit: "celsius",
      },
    });
  },
});

// Create the model provider
const modelProvider = new AnthropicModelProvider({ apiKey });

// Create the ACP server with the factory pattern
const server = acpStdioServer(async (cwd) => {
  return await createZypherAgent({
    modelProvider,
    tools: [getWeather],
    workingDirectory: cwd,
  });
});

server.start();
