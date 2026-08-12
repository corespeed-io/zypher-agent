import { assertEquals } from "@std/assert";
import { createModelProvider } from "./model.ts";
import { PROVIDER_PRESETS } from "./provider_presets.ts";

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

    const provider = createModelProvider(`${presetName}/MiniMax-M3`, {
      apiKey: "test-key",
    });
    assertEquals(provider.info.name, providerName);
    assertEquals(provider.modelId, "MiniMax-M3");
  }
});
