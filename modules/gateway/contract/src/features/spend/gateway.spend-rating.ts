import {
  computeCost,
  getStaticModelCostRates,
  llmModels,
  findMatchingModelCost,
  type ModelCostRate,
} from "@langwatch/model-provider-contract";

import type { SpendUsage } from "./gateway-spend.schemas.ts";

// Quantities in, integer nano-USD out, deterministic per (model, quantities, rate version);
// the gateway's spend pipeline and governance's pulled usage both rate through it.

export const NANO_USD_PER_USD = 1_000_000_000;

/** Stable identities for the two catalog faults; what an alert or a log filter keys on. */
export const UNPRICED_QUANTITIES_CODE = "spend_rating.unpriced_quantities";
export const NO_RATE_RULE_CODE = "spend_rating.no_rate_rule";

export type SpendRatingFault = {
  code: typeof UNPRICED_QUANTITIES_CODE | typeof NO_RATE_RULE_CODE;
  measured: Record<string, number>;
};

/** Quantities reported for display that no rate ever prices. */
const UNPRICED_QUANTITY_NAMES = new Set<string>(["image_count"]);

function measuredQuantities(usage: SpendUsage): Record<string, number> {
  const measured: Record<string, number> = {};
  for (const [name, value] of Object.entries(usage)) {
    if (UNPRICED_QUANTITY_NAMES.has(name)) continue;
    if (typeof value === "number" && value > 0) measured[name] = value;
  }
  return measured;
}

/** A rule whose every rate is zero is a deliberately free model, not a catalog fault. */
function pricesAnything(rule: ModelCostRate): boolean {
  return [
    rule.inputCostPerToken,
    rule.outputCostPerToken,
    rule.cacheReadCostPerToken,
    rule.cacheCreationCostPerToken,
    rule.cacheCreation1hCostPerToken,
    rule.inputAudioCostPerToken,
    rule.outputAudioCostPerToken,
    rule.inputImageCostPerToken,
    rule.outputImageCostPerToken,
    rule.inputCostPerCharacter,
    rule.inputCostPerSecond,
  ].some((rate) => (rate ?? 0) > 0);
}

/** Rate identity stamped when the caller carried none: the registry's regeneration date. */
export function currentRegistryRateVersion(): string {
  const date = (llmModels.updatedAt ?? "").slice(0, 10);
  return date ? `registry@${date}` : "registry@unversioned";
}

export function rateSpendNanoUsd({
  model,
  usage,
  rateVersion,
}: {
  model: string;
  usage: SpendUsage;
  rateVersion?: string;
}): { costNanoUsd: number; rateVersion: string } {
  const rate = findMatchingModelCost(model, getStaticModelCostRates())[0];
  const usd = rate
    ? computeCost({
        rate,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens,
        cacheCreationTokens: usage.cache_creation_input_tokens,
        cacheCreation1hTokens: usage.cache_creation_1h_tokens,
        inputAudioTokens: usage.input_audio_tokens,
        outputAudioTokens: usage.output_audio_tokens,
        inputImageTokens: usage.input_image_tokens,
        outputImageTokens: usage.output_image_tokens,
        inputCharacters: usage.input_chars,
        // The one conversion of the duration quantity: integer milliseconds everywhere else.
        audioSeconds: usage.audio_ms / 1000,
      })
    : 0;
  return {
    costNanoUsd: Math.round((usd ?? 0) * NANO_USD_PER_USD),
    rateVersion: rateVersion && rateVersion.length > 0 ? rateVersion : currentRegistryRateVersion(),
  };
}

/**
 * Why a request that burned something rated at zero: an unknown model, or a rule pricing none
 * of the reported quantities. Empty when nothing was measured or the model is free on purpose.
 */
export function findSpendRatingFaults({
  model,
  usage,
}: {
  model: string;
  usage: SpendUsage;
}): SpendRatingFault[] {
  if (!model || model === "unknown") return [];
  const measured = measuredQuantities(usage);
  const rule = findMatchingModelCost(model, getStaticModelCostRates())[0];
  if (!rule) return [{ code: NO_RATE_RULE_CODE, measured }];
  if (Object.keys(measured).length === 0 || !pricesAnything(rule)) return [];
  return [{ code: UNPRICED_QUANTITIES_CODE, measured }];
}
