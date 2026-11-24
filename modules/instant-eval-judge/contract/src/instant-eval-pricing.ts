/**
 * What an Instant Eval costs us and what the customer pays. Our cost is the input tokens at the
 * classifier's rate, or a routed call's summed cost. The price is the input tokens at the tier's
 * published rate, never below that cost times the markup (ADR-174 decision 25).
 * @see dev/docs/adr/190-instant-evals-routed-judgement-is-priced-from-summed-call-cost.md
 * @see modules/instant-eval-judge/specs/instant-eval-judge-pricing.feature
 */

import type { InstantEvalJudgeRoutePricing } from "./instant-eval-judge-route.ts";
import type { InstantEvalPricing } from "./instant-eval-judge.api.ts";

/** The classifier's rate, measured September 2026, and the markup that is every price's floor. */
export const INSTANT_EVAL_PRICING: InstantEvalPricing = {
  usdPerMillionInputTokens: 0.042,
  markup: 1.3,
};

/**
 * The model the ledger names for an unrouted judgement. Customers read it in billing, so it is
 * the product name, never a backend id; earlier rows carry `langwatch-evals-preview` or `jev`.
 */
export const INSTANT_EVAL_SPEND_MODEL = "langwatch-instant-preview";

/**
 * The request type every Instant Eval spend row carries on `gateway_spend`, the one the meter
 * and the run check sum. Gateway writes it on a judge call's ledger row, so the leaf owns it.
 */
export const INSTANT_EVAL_REQUEST_TYPE = "instant_eval";

/**
 * The tier is the product model. Instant: Instant Preview, so Instant Evals runs, pages and judged
 * queries, routed or not, and an LLM judge on Instant Preview. Evals: Evals Preview, the judge
 * router, so an LLM judge's routed call.
 */
export const INSTANT_EVAL_TIERS = ["instant", "evals"] as const;
export type InstantEvalTier = (typeof INSTANT_EVAL_TIERS)[number];

/** Who asked for the judgement: Instant Evals itself, or an LLM-judge evaluator. */
export type InstantEvalSpendCaller = "instant_eval" | "llm_judge";

/** The one rule for a spend's tier: Evals only for an LLM judge's routed call, else Instant. */
export function instantEvalTierOf({
  caller,
  routed,
}: {
  caller: InstantEvalSpendCaller;
  routed: InstantEvalRoutedSpend | undefined;
}): InstantEvalTier {
  return caller === "llm_judge" && routed ? "evals" : "instant";
}

/** The published customer rates, USD per million input tokens before VAT; output is free. */
export const INSTANT_EVAL_PUBLISHED_RATES: Readonly<Record<InstantEvalTier, number>> = {
  instant: 0.3,
  evals: 0.6,
};

/** The tier's published rate and the floor's numbers, so a price change changes every stamp. */
function publishedRateStamp({ tier }: { tier: InstantEvalTier }): string {
  return `${tier}${INSTANT_EVAL_PUBLISHED_RATES[tier]}`;
}

/**
 * The rate identity stamped on an unrouted outcome: the tier's published rate, then the
 * classifier's rate and markup that set the floor. Rows stamped `instant_eval@<rate>x<markup>`
 * were priced at the cost times the markup alone, before ADR-174 decision 25.
 */
export function instantEvalRateVersion({
  tier,
  pricing = INSTANT_EVAL_PRICING,
}: {
  tier: InstantEvalTier;
  pricing?: InstantEvalPricing;
}): string {
  return `instant_eval@${publishedRateStamp({ tier })}+${pricing.usdPerMillionInputTokens}x${pricing.markup}`;
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

/** Our cost times the markup: the floor of every price, and what a query hold is priced at. */
export function instantEvalFloorPriceUsd({
  costUsd,
  pricing = INSTANT_EVAL_PRICING,
}: {
  costUsd: number;
  pricing?: InstantEvalPricing;
}): number {
  return toNanoUsdPrecision(costUsd * pricing.markup);
}

/**
 * What the customer is charged: the input tokens at the tier's published rate, output free, or
 * our cost times the markup when that is higher, so no call loses money (ADR-174 decision 25).
 */
export function instantEvalPriceUsd({
  costUsd,
  inputTokens,
  tier,
  pricing = INSTANT_EVAL_PRICING,
}: {
  costUsd: number;
  inputTokens: number;
  tier: InstantEvalTier;
  pricing?: InstantEvalPricing;
}): number {
  const atRateUsd =
    (Math.max(inputTokens, 0) / TOKENS_PER_MILLION) * INSTANT_EVAL_PUBLISHED_RATES[tier];
  return Math.max(toNanoUsdPrecision(atRateUsd), instantEvalFloorPriceUsd({ costUsd, pricing }));
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

/**
 * The rate identity a routed judgement's priced fact carries: the tier's published rate, then the
 * route prices and the markup that set the floor. `instant_eval_judge_router@<version>x<markup>`
 * rows were priced at the summed cost times the markup alone, before ADR-174 decision 25.
 */
export function instantEvalJudgeRouteRateVersion({
  routePricing,
  tier,
  pricing = INSTANT_EVAL_PRICING,
}: {
  routePricing: InstantEvalJudgeRoutePricing;
  tier: InstantEvalTier;
  pricing?: InstantEvalPricing;
}): string {
  return `instant_eval_judge_router@${publishedRateStamp({ tier })}+${routePricing.version}x${pricing.markup}`;
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
 * Whether a judgement's, page's, run's or query's spend has anything to bill: input tokens, or a
 * routed cost above zero, which a leg billed for output alone carries with no input tokens. The
 * one gate every judge call, run and query records its spend behind; unrouted, it is tokens > 0.
 */
export function isInstantEvalSpendBillable({
  inputTokens,
  costNanoUsd = 0,
}: {
  inputTokens: number;
  costNanoUsd?: number | undefined;
}): boolean {
  return inputTokens > 0 || costNanoUsd > 0;
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

/** What the customer is charged for a judgement, page or run: its tokens and spent cost, priced. */
export function instantEvalSpentPriceUsd({
  inputTokens,
  costNanoUsd,
  routedInputTokens,
  tier,
  pricing = INSTANT_EVAL_PRICING,
}: {
  inputTokens: number;
  costNanoUsd?: number | undefined;
  routedInputTokens?: number | undefined;
  tier: InstantEvalTier;
  pricing?: InstantEvalPricing;
}): number {
  const costUsd = instantEvalSpentCostUsd({ inputTokens, costNanoUsd, routedInputTokens, pricing });
  return instantEvalPriceUsd({ costUsd, inputTokens, tier, pricing });
}
