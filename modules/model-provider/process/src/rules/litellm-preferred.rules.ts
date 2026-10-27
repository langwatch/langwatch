import type { LLMModelEntry, LLMModelPricing } from "@langwatch/model-provider-contract";

/**
 * Generated models whose rates come from litellm instead of OpenRouter, each with the reason.
 * OpenRouter quotes what its own routing pays; the gateway calls the vendor and pays list price.
 * Remove an id once OpenRouter agrees again: the sync logs the ids it replaced on each run.
 */
export const LITELLM_PREFERRED: Record<string, string> = {
  "deepseek/deepseek-v4-flash":
    "OpenRouter quoted $0.049/$0.098 per million, below even DeepSeek's off-peak rate. " +
    "DeepSeek lists $0.30 input, $1.20 output, $0.006 cache hit at peak " +
    "(https://api-docs.deepseek.com/quick_start/pricing, checked 2026-09-25), which is litellm's number.",
  "deepseek/deepseek-v4-flash-vision-exp":
    "Retired by DeepSeek and served by V4.1 Flash at the Flash price " +
    "(https://api-docs.deepseek.com/quick_start/pricing). litellm carries that price.",
  "deepseek/deepseek-v4-pro":
    "OpenRouter quoted a third-party rate. DeepSeek lists $1.32 input, $3.96 output, $0.044 cache hit at peak " +
    "(https://api-docs.deepseek.com/quick_start/pricing), which is litellm's number.",
  "deepseek/deepseek-v3.2":
    "OpenRouter's cache read was half its input rate, a third-party host. DeepSeek priced V3.2 cache hits " +
    "at $0.028 per million (https://api-docs.deepseek.com/quick_start/pricing, archived 2026-02-01), which is litellm's number.",
  "deepseek/deepseek-chat":
    "Audit gap under 70 percent, so litellm is trusted per the price-audit rule of 2026-09-25.",
  "deepseek/deepseek-r1":
    "Audit gap under 70 percent, so litellm is trusted per the price-audit rule of 2026-09-25.",
  "openai/gpt-5.6-sol":
    "OpenRouter quoted the batch and flex tier. OpenAI lists $4.00 input, $0.40 cached, $20.00 output on the " +
    "standard tier (https://developers.openai.com/api/docs/pricing, checked 2026-09-25), which is litellm's number.",
  "openai/gpt-5.1-codex-mini":
    "Audit gap under 70 percent, so litellm is trusted per the price-audit rule of 2026-09-25.",
  "gemini/gemini-3.5-flash":
    "Audit gap under 70 percent on the audio input rate, so litellm is trusted per the price-audit rule of 2026-09-25.",
  "xai/grok-4.7":
    "Audit gap under 70 percent, so litellm is trusted per the price-audit rule of 2026-09-25.",
};

/** Rate fields litellm can supply and the audit compares. */
const REPLACEABLE_FIELDS = [
  "inputCostPerToken",
  "outputCostPerToken",
  "audioCostPerToken",
  "audioOutputCostPerToken",
  "imageCostPerToken",
  "imageOutputCostPerToken",
  "inputCacheReadPerToken",
  "inputCacheWritePerToken",
  "inputCostPerCharacter",
  "inputCostPerSecond",
] as const satisfies readonly (keyof LLMModelPricing)[];

/**
 * Replaces the listed models' rates with litellm's, in place, and returns the
 * ids changed. An id with no generated entry or no litellm price is left
 * alone, so a litellm outage keeps OpenRouter's rates rather than zeroing anything.
 */
export function applyLitellmPreference({
  models,
  litellmById,
  preferred = LITELLM_PREFERRED,
}: {
  models: Record<string, LLMModelEntry>;
  litellmById: Record<string, LLMModelPricing>;
  preferred?: Record<string, string>;
}): string[] {
  const changed: string[] = [];
  for (const modelId of Object.keys(preferred)) {
    const entry = models[modelId];
    const upstream = litellmById[modelId];
    if (!entry || !upstream) continue;

    const pricing: LLMModelPricing = { ...entry.pricing };
    let touched = false;
    for (const field of REPLACEABLE_FIELDS) {
      const value = upstream[field];
      if (typeof value === "number" && value > 0 && pricing[field] !== value) {
        pricing[field] = value;
        touched = true;
      }
    }
    if (touched) {
      models[modelId] = { ...entry, pricing };
      changed.push(modelId);
    }
  }
  return changed.toSorted();
}
