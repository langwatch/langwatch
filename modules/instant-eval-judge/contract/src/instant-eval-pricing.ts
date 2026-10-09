/**
 * What an Instant Eval costs us and what it costs the customer; only input
 * tokens are priced. @see modules/instant-eval-judge/specs/instant-eval-judge-pricing.feature
 */

import type { InstantEvalPricing } from "./instant-eval-judge.api.ts";

/** The shipped rate, measured September 2026. The markup applies to every plan. */
export const INSTANT_EVAL_PRICING: InstantEvalPricing = {
  usdPerMillionInputTokens: 0.042,
  markup: 1.3,
};

/** The model the ledger names for a judgement: the shipped classifier. */
export const INSTANT_EVAL_SPEND_MODEL = "jev";

/**
 * The request type every Instant Eval spend row carries on `gateway_spend`, the one the meter
 * and the run check sum. Gateway writes it on a judge call's ledger row, so the leaf owns it.
 */
export const INSTANT_EVAL_REQUEST_TYPE = "instant_eval";

/**
 * The rate identity stamped on an outcome. A judgement has no model registry,
 * so it stamps the two published numbers it was priced with: a price change
 * changes the stamp, which tells a replay from a re-rating.
 */
export function instantEvalRateVersion(pricing: InstantEvalPricing = INSTANT_EVAL_PRICING): string {
  return `instant_eval@${pricing.usdPerMillionInputTokens}x${pricing.markup}`;
}

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

/**
 * The one dollar an organization the meter does not bill may spend on Instant Evals. The judge
 * owns the check (ADR-174 decisions 12, 13); runs and judged queries read the same figure.
 */
export const INSTANT_EVAL_FREE_BUDGET_USD = 1;
