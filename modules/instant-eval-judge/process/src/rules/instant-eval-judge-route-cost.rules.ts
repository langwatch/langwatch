/**
 * What one routed call cost us, in integer nano-USD, from the tokens it reported and the
 * backend's configured price. The customer price is the summed cost times the markup.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import {
  instantEvalCostUsd,
  type InstantEvalJudgeRoutePricing,
  type InstantEvalJudgeRouteTable,
  NANO_USD_PER_USD,
} from "@langwatch/instant-eval-judge-contract";

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

/**
 * The hosted classifier's cost for a call the router does not route: its routed price, else the
 * published rate, so every judgement a routed call returns carries a cost.
 */
export function instantEvalJudgeClassifierCostOf({
  table,
  pricing,
  inputTokens,
  outputTokens = 0,
}: {
  table: InstantEvalJudgeRouteTable;
  pricing: InstantEvalJudgeRoutePricing;
  inputTokens: number;
  /** Priced at the routed output rate; the published rate prices input alone. */
  outputTokens?: number;
}): number {
  for (const [backend, config] of Object.entries(table.backends)) {
    if (config.kind !== "jev") continue;
    const cost = instantEvalJudgeCallCostOf({ backend, inputTokens, outputTokens, pricing });
    if (cost.outcome === "priced") return cost.costNanoUsd;
  }
  return Math.round(instantEvalCostUsd({ inputTokens }) * NANO_USD_PER_USD);
}
