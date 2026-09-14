/** Translate model IDs for LiteLLM: dot-to-dash + alias expansion (also in langwatch_nlp). */

/**
 * Model aliases that need expansion to their full dated versions.
 * LiteLLM requires the full dated version for certain models.
 */
const MODEL_ALIASES: Record<string, string> = {
  "anthropic/claude-sonnet-4": "anthropic/claude-sonnet-4-20250514",
  "anthropic/claude-opus-4": "anthropic/claude-opus-4-20250514",
  "anthropic/claude-3.5-haiku": "anthropic/claude-3-5-haiku-20241022",
  "anthropic/claude-3.5-sonnet": "anthropic/claude-3-5-sonnet-20240620",
};

/**
 * Providers that need dot-to-dash translation for their model IDs.
 * Anthropic models use dots in llmModels.json but LiteLLM expects dashes.
 * Custom providers are excluded: their model ids are arbitrary customer
 * strings (e.g. vLLM serving "Qwen/Qwen2.5-32B-Instruct") and rewriting
 * dots would send a model id the endpoint doesn't recognize.
 */
const PROVIDERS_NEEDING_TRANSLATION = ["anthropic"];

/**
 * Extracts the provider from a model ID string.
 * @param modelId - Full model ID (e.g., "anthropic/claude-3.5-sonnet")
 * @returns Provider name or empty string if no prefix
 */
function getProvider(modelId: string): string {
  const slashIndex = modelId.indexOf("/");
  if (slashIndex === -1) {
    return "";
  }
  return modelId.slice(0, slashIndex).toLowerCase();
}

/** Expand dated aliases first, then dot-to-dash; OpenAI/Gemini unchanged. */
export function translateModelIdForLitellm(modelId: string): string {
  if (!modelId) {
    return modelId;
  }

  // First, check for exact alias matches that need expansion
  if (MODEL_ALIASES[modelId]) {
    return MODEL_ALIASES[modelId];
  }

  const provider = getProvider(modelId);

  // Only translate providers that need it
  // Models without a provider prefix are treated as needing translation
  // (they could be Anthropic models referenced without the prefix)
  const needsTranslation = provider === "" || PROVIDERS_NEEDING_TRANSLATION.includes(provider);

  if (!needsTranslation) {
    return modelId;
  }

  // Replace dots with dashes in the entire model ID
  return modelId.replace(/\./g, "-");
}
