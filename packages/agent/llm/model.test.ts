import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { AnthropicModelProvider } from "./anthropic.ts";
import { createModelProvider } from "./model.ts";
import { PROVIDER_PRESETS } from "./provider_presets.ts";

const anthropicResponse = [
  {
    type: "message_start",
    message: {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "test-model",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 0 },
    },
  },
  {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 1 },
  },
  { type: "message_stop" },
].map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  .join("");

Deno.test("MiniMax Anthropic requests preserve model-specific defaults", async () => {
  for (
    const model of ["MiniMax-M3.1-Flash", "MiniMax-M3", "claude-sonnet-4-5"]
  ) {
    for (const thinkingBudget of [undefined, 0, 1024]) {
      let body: Record<string, unknown> = {};
      using _fetch = stub(globalThis, "fetch", async (input, init) => {
        body = await new Request(input, init).json();
        return new Response(anthropicResponse, {
          headers: { "content-type": "text/event-stream" },
        });
      });
      const provider = new AnthropicModelProvider({
        model,
        apiKey: "test-key",
        thinkingBudget,
      });
      await provider.streamChat({
        system: "You are helpful.",
        maxTokens: 2048,
        messages: [{
          role: "user",
          content: [{ type: "text", text: "Hello" }],
          timestamp: new Date(),
        }],
      }).finalMessage();

      assertEquals(body.model, model);
      assertEquals(
        body.thinking,
        model === "MiniMax-M3.1-Flash"
          ? undefined
          : model === "MiniMax-M3" && thinkingBudget
          ? { type: "adaptive" }
          : thinkingBudget
          ? { type: "enabled", budget_tokens: thinkingBudget }
          : { type: "disabled" },
      );
      assertEquals(
        JSON.stringify(body).includes("cache_control"),
        model === "claude-sonnet-4-5",
      );
      assertEquals(body.service_tier, undefined);
    }
  }
});

Deno.test("createModelProvider selects MiniMax protocol presets", () => {
  const cases = [
    ["minimax", "openai", "https://api.minimax.io/v1"],
    ["minimax-cn", "openai", "https://api.minimaxi.com/v1"],
    [
      "minimax-anthropic",
      "anthropic",
      "https://api.minimax.io/anthropic",
    ],
    [
      "minimax-cn-anthropic",
      "anthropic",
      "https://api.minimaxi.com/anthropic",
    ],
  ] as const;

  for (const [presetName, providerName, baseUrl] of cases) {
    assertEquals(PROVIDER_PRESETS[presetName], {
      provider: providerName,
      baseUrl,
    });

    for (
      const modelId of ["MiniMax-M3.1-Flash", "MiniMax-M3", "custom-model"]
    ) {
      const provider = createModelProvider(`${presetName}/${modelId}`, {
        apiKey: "test-key",
      });
      assertEquals(provider.info.name, providerName);
      assertEquals(provider.modelId, modelId);
    }
  }
});
