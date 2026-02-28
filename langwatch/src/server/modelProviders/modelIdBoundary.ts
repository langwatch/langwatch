/**
 * Model ID translation at the LiteLLM boundary.
 *
 * LiteLLM expects model IDs with dashes but llmModels.json uses dots for version numbers.
 * This module provides runtime dot-to-dash conversion at the API boundary.
 *
 * Example: "anthropic/claude-opus-4.5" -> "anthropic/claude-opus-4-5"
 *
 * Additionally, some models require alias expansion to their full dated versions.
 * Example: "anthropic/claude-sonnet-4" -> "anthropic/claude-sonnet-4-20250514"
 *
 * IMPORTANT: This logic is duplicated in Python (langwatch_nlp/studio/utils.py).
 * Changes here MUST be mirrored there.
 * @see langwatch_nlp/langwatch_nlp/studio/utils.py#translate_model_id_for_litellm
 */

/**
 * Model aliases that need expansion to their full dated versions.
 * LiteLLM requires the full dated version for certain models.
 */
const MODEL_ALIASES: Record<string, string> = {
  "anthropic/claude-sonnet-4": "anthropic/claude-sonnet-4-20250514",
  "anthropic/claude-opus-4": "anthropic/claude-opus-4-20250514",
  "anthropic/claude-3.5-haiku": "anthropic/claude-3-5-haiku-20241022",
};

/**
 * Providers that need dot-to-dash translation for their model IDs.
 * Anthropic models use dots in llmModels.json but LiteLLM expects dashes.
 */
const PROVIDERS_NEEDING_TRANSLATION = ["anthropic", "custom"];

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

/**
 * Translates a model ID for use with LiteLLM.
 *
 * First checks for exact alias matches that need expansion to dated versions.
 * Then converts dots to dashes in model IDs for providers that need it (Anthropic, custom).
 * Other providers (OpenAI, Gemini, etc.) are returned unchanged.
 *
 * @param modelId - The model ID from llmModels.json (e.g., "anthropic/claude-opus-4.5")
 * @returns The translated model ID for LiteLLM (e.g., "anthropic/claude-opus-4-5")
 */
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
  const needsTranslation =
    provider === "" || PROVIDERS_NEEDING_TRANSLATION.includes(provider);

  if (!needsTranslation) {
    return modelId;
  }

  // Replace dots with dashes in the entire model ID
  return modelId.replace(/\./g, "-");
}
