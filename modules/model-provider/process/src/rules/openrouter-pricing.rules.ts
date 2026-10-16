import { type LLMModelPricing, VARIABLE_PRICE_MARKER } from "@langwatch/model-provider-contract";
import type { Model } from "@openrouter/sdk/models";

/** Raw pricing keys the OpenRouter SDK's generated schema drops. */
export type RawPricing = Record<string, string | number | undefined>;

function parsePrice(value: string | number | undefined): number {
  return value ? parseFloat(String(value)) || 0 : 0;
}

/**
 * A required rate. OpenRouter states -1 for a router, whose price depends on what it routes to;
 * any negative price becomes the catalog's router marker, never a refund.
 */
function requiredRate(value: string | number | undefined): number {
  const rate = parsePrice(value);
  return rate < 0 ? VARIABLE_PRICE_MARKER : rate;
}

/** The catalog pricing for one OpenRouter model. Optional rates are kept only when positive. */
export function toCatalogPricing({
  pricing,
  raw,
}: {
  pricing: Model["pricing"];
  raw?: RawPricing;
}): LLMModelPricing {
  const result: LLMModelPricing = {
    inputCostPerToken: requiredRate(pricing.prompt),
    outputCostPerToken: requiredRate(pricing.completion),
  };

  const inputCacheRead = parsePrice(pricing.inputCacheRead);
  if (inputCacheRead > 0) result.inputCacheReadPerToken = inputCacheRead;

  const inputCacheWrite = parsePrice(pricing.inputCacheWrite);
  if (inputCacheWrite > 0) result.inputCacheWritePerToken = inputCacheWrite;

  // The hour-long prompt-cache write rate. Without it the catalog falls back
  // to a hardcoded 2x-of-input derivation that only covers Anthropic ids.
  const inputCacheWrite1h = parsePrice(raw?.input_cache_write_1h);
  if (inputCacheWrite1h > 0) result.inputCacheWrite1hPerToken = inputCacheWrite1h;

  const imageCost = parsePrice(pricing.image);
  if (imageCost > 0) result.imageCostPerToken = imageCost;

  const imageOutput = parsePrice(pricing.imageOutput);
  if (imageOutput > 0) result.imageOutputCostPerToken = imageOutput;

  const audioCost = parsePrice(pricing.audio);
  if (audioCost > 0) result.audioCostPerToken = audioCost;

  const internalReasoning = parsePrice(pricing.internalReasoning);
  if (internalReasoning > 0) result.internalReasoningCostPerToken = internalReasoning;

  const webSearch = parsePrice(pricing.webSearch);
  if (webSearch > 0) result.webSearchCostPerQuery = webSearch;

  return result;
}
