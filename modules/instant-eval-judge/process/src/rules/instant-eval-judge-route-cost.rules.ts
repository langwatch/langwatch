/**
 * What one routed call cost us, in integer nano-USD, from the tokens it reported and the
 * backend's configured price. The customer price is the summed cost times the markup.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import type { InstantEvalJudgeRoutePricing } from "@langwatch/instant-eval-judge-contract";

const NANO_USD_PER_MILLION_TOKENS_PER_USD = 1_000;

/** The call's cost, or `unpriced` when the backend has no configured price. */
type InstantEvalJudgeCallCost =
  | Readonly<{ outcome: "priced"; costNanoUsd: number }>
  | Readonly<{ outcome: "unpriced" }>;

export function instantEvalJudgeCallCostOf({
  backend,
  inputTokens,
  outputTokens,
  pricing,
}: {
  backend: string;
  inputTokens: number;
  outputTokens: number;
  pricing: InstantEvalJudgeRoutePricing;
}): InstantEvalJudgeCallCost {
  const price = pricing.backends[backend];
  if (!price) return { outcome: "unpriced" };
  const rate =
    price.longContext && inputTokens > price.longContext.aboveInputTokens
      ? price.longContext
      : price;
  // USD per million tokens is nano-USD per thousand tokens.
  const nano =
    (inputTokens * rate.usdPerMillionInputTokens + outputTokens * rate.usdPerMillionOutputTokens) *
    NANO_USD_PER_MILLION_TOKENS_PER_USD;
  return { outcome: "priced", costNanoUsd: Math.round(nano) };
}
