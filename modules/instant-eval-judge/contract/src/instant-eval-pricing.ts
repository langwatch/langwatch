/**
 * What an Instant Eval costs us and what it costs the customer. An unrouted judgement is priced
 * from its input tokens at the classifier's published rate; a routed one from the summed cost of
 * its calls (input and output tokens at per-backend prices), at the same markup.
 * @see dev/docs/adr/190-instant-evals-routed-judgement-is-priced-from-summed-call-cost.md
 * @see modules/instant-eval-judge/specs/instant-eval-judge-pricing.feature
 */

import type { InstantEvalJudgeRoutePricing } from "./instant-eval-judge-route.ts";
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
export const NANO_USD_PER_USD = 1_000_000_000;

/** A dollar amount rounded to the ledger's nano-USD unit, with no float noise past it. */
export function toNanoUsdPrecision(usd: number): number {
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

/** The public prices: the hosted classifier's published rate only. */
export const INSTANT_EVAL_JUDGE_DEFAULT_ROUTE_PRICING: InstantEvalJudgeRoutePricing = {
  version: "default",
  backends: {
    jev: {
      usdPerMillionInputTokens: INSTANT_EVAL_PRICING.usdPerMillionInputTokens,
      usdPerMillionOutputTokens: 0,
    },
  },
};

/** The model the ledger names for a routed judgement: one product, whichever backend answered. */
export const INSTANT_EVAL_JUDGE_ROUTED_SPEND_MODEL = "langwatch-judge";

/** The rate identity a routed judgement's priced fact carries: the route prices and the markup. */
export function instantEvalJudgeRouteRateVersion({
  routePricing,
  pricing = INSTANT_EVAL_PRICING,
}: {
  routePricing: InstantEvalJudgeRoutePricing;
  pricing?: InstantEvalPricing;
}): string {
  return `instant_eval_judge_router@${routePricing.version}x${pricing.markup}`;
}

/**
 * What a judgement, page or run cost us: the routed calls' summed cost, plus the tokens no route
 * covered at the published rate. Zero routed tokens is an unrouted spend, priced as before.
 */
export function instantEvalSpentCostUsd({
  inputTokens,
  costNanoUsd = 0,
  routedInputTokens = 0,
  pricing = INSTANT_EVAL_PRICING,
}: {
  inputTokens: number;
  costNanoUsd?: number | undefined;
  /** The tokens `costNanoUsd` covers; the rest are priced at the published rate. */
  routedInputTokens?: number | undefined;
  pricing?: InstantEvalPricing;
}): number {
  const unroutedUsd = instantEvalCostUsd({ inputTokens: inputTokens - routedInputTokens, pricing });
  return toNanoUsdPrecision(costNanoUsd / NANO_USD_PER_USD + unroutedUsd);
}

/** The routed part of a spend: the summed routed cost and the input tokens it covers. */
export type InstantEvalRoutedSpend = Readonly<{ costNanoUsd: number; routedInputTokens: number }>;

/**
 * The routed part of a page's, run's or query's spend, or undefined when nothing was routed. Routed
 * tokens or a routed cost above zero mark it, so a cost that covers no input tokens (a backend
 * that bills output alone) is billed too. The one rule for "routed" past a single judgement.
 */
export function pickInstantEvalRoutedSpend({
  costNanoUsd = 0,
  routedInputTokens = 0,
}: {
  costNanoUsd?: number | undefined;
  routedInputTokens?: number | undefined;
}): InstantEvalRoutedSpend | undefined {
  if (costNanoUsd <= 0 && routedInputTokens <= 0) return undefined;
  return { costNanoUsd, routedInputTokens };
}

/**
 * One judgement's routed part. The router prices every judgement it returns, so a cost, zero
 * included, routes all of its input tokens; no cost is an unrouted judgement.
 */
export function pickInstantEvalJudgementRoutedSpend({
  inputTokens,
  costNanoUsd,
}: {
  inputTokens: number;
  costNanoUsd?: number | undefined;
}): InstantEvalRoutedSpend | undefined {
  if (costNanoUsd === undefined) return undefined;
  return pickInstantEvalRoutedSpend({ costNanoUsd, routedInputTokens: inputTokens });
}

/** What the customer is charged for a judgement, page or run: its spent cost at the markup. */
export function instantEvalSpentPriceUsd({
  inputTokens,
  costNanoUsd,
  routedInputTokens,
  pricing = INSTANT_EVAL_PRICING,
}: {
  inputTokens: number;
  costNanoUsd?: number | undefined;
  routedInputTokens?: number | undefined;
  pricing?: InstantEvalPricing;
}): number {
  const costUsd = instantEvalSpentCostUsd({ inputTokens, costNanoUsd, routedInputTokens, pricing });
  return instantEvalPriceUsd({ costUsd, pricing });
}
