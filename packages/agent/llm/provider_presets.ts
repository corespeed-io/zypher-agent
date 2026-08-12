export type ProviderPreset = {
  provider: "anthropic" | "openai";
  baseUrl: string;
};

/**
 * Explicit provider presets for MiniMax protocol and region selection.
 */
export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  minimax: {
    provider: "openai",
    baseUrl: "https://api.minimax.io/v1",
  },
  "minimax-cn": {
    provider: "openai",
    baseUrl: "https://api.minimaxi.com/v1",
  },
  "minimax-anthropic": {
    provider: "anthropic",
    baseUrl: "https://api.minimax.io/anthropic",
  },
  "minimax-cn-anthropic": {
    provider: "anthropic",
    baseUrl: "https://api.minimaxi.com/anthropic",
  },
};
