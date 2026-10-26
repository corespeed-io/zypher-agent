# AG-UI Example

This example demonstrates how to run ZypherAgent as an AG-UI compatible server
that can connect to AG-UI frontends like [CopilotKit](https://copilotkit.ai).

## Quick Start

1. Set your API key in a `.env` file:

```bash
ANTHROPIC_API_KEY=your_api_key
```

2. Install UI dependencies:

```bash
cd ui
bun install
```

3. Start the agent server (in one terminal):

```bash
# From examples/agui directory
deno run --env --allow-all ./server.ts
```

4. Start the UI (in another terminal):

```bash
cd ui
bun dev
```

5. Open `http://localhost:3000` to use the CopilotKit chat interface

## Project Structure

```
examples/agui/
├── server.ts       # Zypher AG-UI server (port 8000)
├── ui/             # CopilotKit frontend (port 3000)
│   ├── src/
│   │   ├── app/    # Next.js pages
│   │   └── components/
│   └── package.json
└── README.md
```

## Configuration

### Environment Variables

- `ANTHROPIC_API_KEY` - Your Anthropic API key (required)
- `PORT` - Server port (default: 8000)
- `ZYPHER_MODEL` - Model to use (default: claude-sonnet-5-5)

### Custom Tools

The example includes a **Weather tool** for testing backend_tool_rendering.

To add custom tools, modify `server.ts`:

```typescript
import { createTool } from "@zypher/agent/tools";
import { z } from "zod";

const myTool = createTool({
  name: "my_tool",
  description: "Description of my tool",
  schema: z.object({
    param: z.string().describe("Parameter description"),
  }),
  execute: async ({ param }) => {
    return {
      content: [{ type: "text", text: `Result: ${param}` }],
    };
  },
});

const agent = await createZypherAgent({
  modelProvider,
  tools: [myTool],
});
```

### Backend Tool Rendering

For tools that render custom UI in the frontend (like weather cards), return
structured JSON in the text content:

```typescript
const getWeatherTool = createTool({
  name: "get_weather",
  description: "Get weather for a location",
  schema: z.object({
    location: z.string().describe("City name"),
  }),
  execute: ({ location }) => {
    // Return CallToolResult with JSON string for frontend rendering
    return Promise.resolve({
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          location,
          temperature: 22,
          conditions: "sunny",
          humidity: 45,
          wind_speed: 10,
          feels_like: 24,
        }),
      }],
    });
  },
});
```

The frontend (CopilotKit) can then render this with `useCopilotAction`:

```tsx
useCopilotAction({
  name: "get_weather",
  available: "disabled", // Don't expose to LLM, just render results
  render: ({ args, result, status }) => {
    if (status !== "complete") {
      return <div>Loading weather...</div>;
    }
    return <WeatherCard {...result} />;
  },
});
```

## API Reference

See the full API reference on JSR: https://jsr.io/@zypher/agent/doc
