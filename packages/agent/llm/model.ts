import type { ModelProvider, ModelProviderOptions } from "./model_provider.ts";
import {
  AnthropicModelProvider,
  type AnthropicModelProviderOptions,
} from "./anthropic.ts";
import {
  OpenAIModelProvider,
  type OpenAIModelProviderOptions,
} from "./openai.ts";

/**
 * Default models for each provider.
 */
export const DEFAULT_MODELS = {
  anthropic: "claude-sonnet-4-5-20250929",
  openai: "gpt-5.2",
} as const;

/**
 * Supported provider names (only Anthropic and OpenAI are supported).
 */
export type ProviderName = keyof typeof DEFAULT_MODELS;

/**
 * Default base URLs for OpenAI-compatible providers.
 * These are used when the model name matches a known pattern.
 */
const MODEL_BASE_URLS: Record<string, string> = {
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  deepseek: "https://api.deepseek.com/v1",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  grok: "https://api.x.ai/v1",
  minimax: "https://api.minimax.io/v1",
};

/**
 * Infers the provider from well-known model name patterns.
 * Only returns "anthropic" or "openai" since these are the only supported providers.
 *
 * - Anthropic: claude*, sonnet*, haiku*, opus*
 * - OpenAI (default): Everything else, including OpenAI-compatible models
 */
function inferProvider(model: string): ProviderName {
  const m = model.toLowerCase();

  // Anthropic models
  if (
    m.includes("claude") || m.startsWith("sonnet") ||
    m.startsWith("haiku") || m.startsWith("opus")
  ) {
    return "anthropic";
  }

  // Default to OpenAI for all other models (OpenAI-compatible is de facto standard)
  return "openai";
}

/**
 * Infers a default base URL for well-known OpenAI-compatible models.
 * Returns undefined if the model doesn't match any known pattern.
 */
function inferBaseUrl(model: string): string | undefined {
  const m = model.toLowerCase();

  for (const [prefix, baseUrl] of Object.entries(MODEL_BASE_URLS)) {
    if (m.startsWith(prefix)) {
      return baseUrl;
    }
  }

  return undefined;
}

/**
 * Create a ModelProvider from a string specification.
 *
 * This is a simple helper for quickly creating providers with default settings.
 * For provider-specific options (e.g., thinkingBudget, reasoningEffort),
 * use the `anthropic()` or `openai()` helper functions instead.
 *
 * Supports two formats:
 * - Explicit: "provider/model-id" (e.g., "anthropic/claude-sonnet-4-5-20250929")
 * - Auto-inferred: "model-id" (e.g., "claude-sonnet-4-5-20250929" → anthropic)
 *
 * Provider is auto-inferred from well-known model name patterns:
 * - Anthropic: claude*, sonnet*, haiku*, opus*
 * - OpenAI (default): Everything else, including OpenAI-compatible models
 *
 * For OpenAI-compatible models, default base URLs are provided for:
 * - gemini* → Google AI (generativelanguage.googleapis.com)
 * - deepseek* → DeepSeek (api.deepseek.com)
 * - qwen* → Alibaba DashScope (dashscope.aliyuncs.com)
 * - grok* → xAI (api.x.ai)
 * - minimax* → MiniMax (api.minimax.io)
 *
 * @example
 * ```typescript
 * // Explicit provider/model format
 * const provider = createModelProvider("anthropic/claude-sonnet-4-5-20250929");
 * const provider = createModelProvider("openai/gpt-5.2");
 *
 * // Auto-inferred provider from model name
 * const provider = createModelProvider("claude-sonnet-4-5-20250929"); // → anthropic
 * const provider = createModelProvider("gpt-5.2");                    // → openai
 * const provider = createModelProvider("gemini-2.0-flash");           // → openai (with Google base URL)
 * const provider = createModelProvider("deepseek-chat");              // → openai (with DeepSeek base URL)
 * const provider = createModelProvider("qwen-plus");                  // → openai (with DashScope base URL)
 * const provider = createModelProvider("grok-2");                     // → openai (with xAI base URL)
 * const provider = createModelProvider("MiniMax-M3");                  // → openai (with MiniMax base URL)
 * const provider = createModelProvider("llama-3.3-70b");              // → openai (no default URL, self-hosted)
 *
 * // With options (API key optional - falls back to env vars)
 * const provider = createModelProvider("gpt-5.2", { apiKey: "..." });
 *
 * // For provider-specific options, use the dedicated helpers:
 * const provider = anthropic("claude-sonnet-4-5-20250929", { thinkingBudget: 10000 });
 * const provider = openai("o1", { reasoningEffort: "high" });
 * ```
 *
 * @param modelString - Model specification: "provider/model-id" or just "model-id"
 * @param options - Optional configuration (apiKey, baseUrl)
 * @returns A configured ModelProvider instance
 */
export function createModelProvider(
  modelString: string,
  options: ModelProviderOptions = {},
): ModelProvider {
  let provider: string;
  let modelId: string;

  const slashIndex = modelString.indexOf("/");
  if (slashIndex !== -1) {
    // Explicit format: "provider/model"
    provider = modelString.slice(0, slashIndex);
    modelId = modelString.slice(slashIndex + 1);

    if (!modelId) {
      throw new Error(
        `Invalid model string "${modelString}". Model ID cannot be empty.`,
      );
    }
  } else {
    // Auto-detect provider from model name
    provider = inferProvider(modelString);
    modelId = modelString;
  }

  const providerKey = provider.toLowerCase();
  // Use explicit baseUrl if provided, otherwise infer from model name
  const baseUrl = options.baseUrl ?? inferBaseUrl(modelId);

  switch (providerKey) {
    case "anthropic":
      return new AnthropicModelProvider({
        model: modelId,
        apiKey: options.apiKey,
        baseUrl,
      });

    case "openai":
    default:
      // OpenAI and all OpenAI-compatible providers
      return new OpenAIModelProvider({
        model: modelId,
        apiKey: options.apiKey,
        baseUrl,
      });
  }
}

/**
 * Create an Anthropic ModelProvider.
 *
 * @example
 * ```typescript
 * const model = anthropic("claude-sonnet-4-20250514");
 * const model = anthropic("claude-sonnet-4-20250514", { apiKey: "..." });
 * ```
 */
export function anthropic(
  modelId: string,
  options?: Omit<AnthropicModelProviderOptions, "model">,
): ModelProvider {
  return new AnthropicModelProvider({ model: modelId, ...options });
}

/**
 * Create an OpenAI ModelProvider.
 *
 * @example
 * ```typescript
 * const model = openai("gpt-4o");
 * const model = openai("o1", { reasoningEffort: "high" });
 * ```
 */
export function openai(
  modelId: string,
  options?: Omit<OpenAIModelProviderOptions, "model">,
): ModelProvider {
  return new OpenAIModelProvider({ model: modelId, ...options });
}
