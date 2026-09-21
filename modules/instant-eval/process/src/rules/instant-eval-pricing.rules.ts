/**
 * What an Instant Eval costs us and what it costs the customer; only input
 * tokens are priced. @see specs/instant-evals/instant-eval-cost.feature
 */

import type { InstantEvalPricing } from "@langwatch/instant-eval-contract";

/** The shipped rate, measured September 2026. The markup applies to every plan. */
export const INSTANT_EVAL_PRICING: InstantEvalPricing = {
  usdPerMillionInputTokens: 0.042,
  markup: 1.3,
};

const TOKENS_PER_MILLION = 1_000_000;

/** The ledger keeps integer nano-USD, so amounts round to nine decimals. */
const NANO_USD_PER_USD = 1_000_000_000;

function toNanoUsdPrecision(usd: number): number {
  return Math.round(usd * NANO_USD_PER_USD) / NANO_USD_PER_USD;
}

/** What the judge charged us for these input tokens. */
export function instantEvalCostUsd({
  inputTokens,
  pricing = INSTANT_EVAL_PRICING,
}: {
  inputTokens: number;
  pricing?: InstantEvalPricing;
}): number {
  if (inputTokens <= 0) return 0;
  return toNanoUsdPrecision((inputTokens / TOKENS_PER_MILLION) * pricing.usdPerMillionInputTokens);
}

/** What the customer is charged for a cost of ours. */
export function instantEvalPriceUsd({
  costUsd,
  pricing = INSTANT_EVAL_PRICING,
}: {
  costUsd: number;
  pricing?: InstantEvalPricing;
}): number {
  return toNanoUsdPrecision(costUsd * pricing.markup);
}
