/**
 * AG-UI Server Example
 *
 * Demonstrates how to use the transport-agnostic createAguiEventStream API
 * with SSE transport in Deno.
 *
 * Run: deno run --env --allow-all ./server.ts
 */

import "@std/dotenv/load";
import { z } from "zod";
import { createZypherAgent } from "@zypher/agent";
import { createTool } from "@zypher/agent/tools";
import { createAguiEventStream, parseRunAgentInput } from "@zypher/agui";
import type { Message } from "@ag-ui/core";
import { eachValueFrom } from "rxjs-for-await";

const DEFAULT_MODEL = "claude-sonnet-5-5";

// Example: Weather tool
const getWeatherTool = createTool({
  name: "get_weather",
  description: "Get the current weather for a given location",
  schema: z.object({
    location: z.string().describe("The city name, e.g., 'San Francisco'"),
    unit: z
      .enum(["celsius", "fahrenheit"])
      .optional()
      .default("celsius")
      .describe("Temperature unit"),
  }),
  execute: ({ location, unit }) => {
    // Simulated weather data - replace with actual API call
    const temp = unit === "fahrenheit" ? 72 : 22;
    console.log(`Fetching weather for ${location} in ${unit}...`);
    // Return CallToolResult with JSON string for backend_tool_rendering
    return Promise.resolve({
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          location,
          temperature: temp,
          conditions: "sunny",
          humidity: 45,
          wind_speed: 10,
          feels_like: temp + 2,
        }),
      }],
    });
  },
});

const agent = await createZypherAgent({
  model: Deno.env.get("ZYPHER_MODEL") ?? DEFAULT_MODEL,
  tools: [getWeatherTool],
});

Deno.serve({ port: 8000 }, async (request) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Parse the AG-UI request
  const input = parseRunAgentInput(await request.json());

  // Create the transport-agnostic event stream
  const events$ = createAguiEventStream({
    agent,
    messages: input.messages as Message[],
    state: input.state,
    threadId: input.threadId ?? crypto.randomUUID(),
    runId: input.runId ?? crypto.randomUUID(),
  });

  // Implement SSE encoding for Deno runtime
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const event of eachValueFrom(events$)) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream" },
  });
});

console.log("AG-UI server running on http://localhost:8000");
