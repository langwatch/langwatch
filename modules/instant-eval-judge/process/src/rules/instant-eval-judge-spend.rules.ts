/**
 * One judge call's spend: its request id and the priced fact the judge appends (ADR-174 decisions
 * 8, 9, 13). The customer price is what the spend row, the ledger and the meter carry.
 * Spec: modules/instant-eval/specs/instant-eval-judge-model.feature
 */

import {
  INSTANT_EVAL_JUDGE_ROUTED_SPEND_MODEL,
  INSTANT_EVAL_PRICING,
  INSTANT_EVAL_SPEND_MODEL,
  instantEvalCostUsd,
  instantEvalJudgeRouteRateVersion,
  instantEvalPriceUsd,
  instantEvalRateVersion,
  NANO_USD_PER_USD,
  type InstantEvalJudgeRoutePricing,
  type InstantEvalJudgeSpendPricedEventData,
  type InstantEvalPricing,
} from "@langwatch/instant-eval-judge-contract";

/** The prefix a keyed judge call's request id carries, so the id is the evaluation's own. */
const KEYED_REQUEST_ID_PREFIX = "instantevaljudge_";

/**
 * A redelivered evaluation carries the same retry key, so it lands on the same request id and
 * every row keyed by it stays one. A call with no key mints a fresh id: a retry is a new call.
 */
export function instantEvalJudgeSpendRequestId({
  requestKey,
  mint,
}: {
  requestKey: string | undefined;
  mint: () => string;
}): string {
  return requestKey ? `${KEYED_REQUEST_ID_PREFIX}${requestKey}` : mint();
}

/** What the call is priced at, and the fact that records it. */
export function instantEvalJudgeSpendPricedOf({
  organizationId,
  projectId,
  requestId,
  inputTokens,
  occurredAt,
  requests,
  runId,
  pricing = INSTANT_EVAL_PRICING,
  routed,
}: {
  organizationId: string;
  projectId: string;
  requestId: string;
  inputTokens: number;
  occurredAt: number;
  /** A run's or query's classifications; a judge call is one and leaves it out. */
  requests?: number | undefined;
  runId?: string | undefined;
  pricing?: InstantEvalPricing;
  /** A routed spend: its summed cost, priced at the router's markup under the router's model. */
  routed?: Readonly<{ costNanoUsd: number; pricing: InstantEvalJudgeRoutePricing }> | undefined;
}): Readonly<{ priceUsd: number; fact: InstantEvalJudgeSpendPricedEventData }> {
  const costUsd = routed
    ? routed.costNanoUsd / NANO_USD_PER_USD
    : instantEvalCostUsd({ inputTokens, pricing });
  const priceUsd = instantEvalPriceUsd({
    costUsd,
    pricing: routed ? { ...pricing, markup: routed.pricing.markup } : pricing,
  });
  return {
    priceUsd,
    fact: {
      tenantId: organizationId,
      occurredAt,
      organizationId,
      projectId,
      requestId,
      model: routed ? INSTANT_EVAL_JUDGE_ROUTED_SPEND_MODEL : INSTANT_EVAL_SPEND_MODEL,
      rateVersion: routed
        ? instantEvalJudgeRouteRateVersion(routed.pricing)
        : instantEvalRateVersion(pricing),
      inputTokens,
      priceNanoUsd: Math.round(priceUsd * NANO_USD_PER_USD),
      costNanoUsd: Math.round(costUsd * NANO_USD_PER_USD),
      ...(requests === undefined ? {} : { requests }),
      ...(runId === undefined ? {} : { runId }),
    },
  };
}
