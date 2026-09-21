/**
 * What one Instant Eval's spend looks like on the gateway spend spine: a
 * confirmed outcome with no admission in front of it, priced here once, the
 * customer price on the record and our own cost beside it in the metadata.
 * @see specs/instant-evals/instant-eval-billing.feature
 */

import type { InstantEvalPricing } from "@langwatch/instant-eval-contract";
import { generate } from "@langwatch/ksuid";

import { INSTANT_EVAL_PRICING } from "./instant-eval-pricing.rules.ts";

/** The request type every Instant Eval spend row carries on `gateway_spend`. */
export const INSTANT_EVAL_REQUEST_TYPE = "instant_eval";

/** The model the ledger names for a judgement: the shipped classifier. */
export const INSTANT_EVAL_SPEND_MODEL = "jev";

/** USD to integer nano-USD, the spine's own unit, rounded once. */
export const NANO_USD_PER_USD = 1_000_000_000;

/** The prefix a run's request id carries, so the id is the run's own. */
const RUN_REQUEST_ID_PREFIX = "instanteval_";

/**
 * The app's KSUID resource for a judged query (`INSTANT_EVAL_QUERY`). The
 * literal rather than a constant table, for the same reason the run writer
 * carries its own: the prefix is on every id a customer has seen.
 */
const INSTANT_EVAL_QUERY_KSUID_RESOURCE = "instantevalquery";

/** What one query or one run spent on judgements. */
export interface InstantEvalSpendRecord {
  readonly projectId: string;
  /**
   * The run this spend belongs to, when it belongs to one. A synchronous
   * query has no durable resource to point at; naming a run is what makes
   * "what did that run cost" a query rather than a guess from timestamps.
   */
  readonly runId?: string;
  /** Input tokens the classifier billed for. */
  readonly inputTokens: number;
  /** Classifications made, which is one per judged text. */
  readonly requests: number;
  /** What the classifier charged us, in USD. */
  readonly costUsd: number;
  /** What the customer is charged, in USD: the cost at the published markup. */
  readonly priceUsd: number;
  readonly occurredAt: Date;
}

/** Who a project's spend is billed against. */
export interface InstantEvalSpendAttribution {
  readonly organizationId: string;
  readonly teamId: string;
}

/**
 * A run's id is derived from the run, so a finish delivered twice appends the
 * same request and the spine's own idempotency key drops the second. A query
 * mints a fresh one, so a retry is a second query — which is what it is.
 */
export function instantEvalSpendRequestId({ runId }: { runId?: string }): string {
  return runId
    ? `${RUN_REQUEST_ID_PREFIX}${runId}`
    : generate(INSTANT_EVAL_QUERY_KSUID_RESOURCE).toString();
}

/**
 * The rate identity stamped on the outcome. A judgement has no model registry,
 * so it stamps the two published numbers it was priced with: a price change
 * changes the stamp, which tells a replay from a re-rating.
 */
export function instantEvalRateVersion(pricing: InstantEvalPricing = INSTANT_EVAL_PRICING): string {
  return `instant_eval@${pricing.usdPerMillionInputTokens}x${pricing.markup}`;
}

export function usdToNanoUsd(usd: number): number {
  return Math.round(usd * NANO_USD_PER_USD);
}

/**
 * The metadata JSON the row carries beside the price, so the margin is
 * recoverable from the row without recomputing a rate that will change.
 */
export function instantEvalSpendMetadata(
  record: Pick<InstantEvalSpendRecord, "costUsd" | "requests" | "runId">,
): string {
  return JSON.stringify({
    instant_eval: {
      cost_usd: record.costUsd,
      requests: record.requests,
      ...(record.runId ? { run_id: record.runId } : {}),
    },
  });
}

/** The priced outcome one query or run appends to the spend spine. */
export interface InstantEvalPricedSpend {
  readonly requestId: string;
  readonly projectId: string;
  readonly organizationId: string;
  readonly teamId: string;
  readonly requestType: string;
  readonly model: string;
  readonly rateVersion: string;
  readonly inputTokens: number;
  readonly costNanoUsd: number;
  readonly metadata: string;
  /** Epoch milliseconds. */
  readonly occurredAt: number;
}

export function instantEvalPricedSpend({
  record,
  attribution,
  requestId,
  pricing = INSTANT_EVAL_PRICING,
}: {
  record: InstantEvalSpendRecord;
  attribution: InstantEvalSpendAttribution;
  requestId: string;
  pricing?: InstantEvalPricing;
}): InstantEvalPricedSpend {
  return {
    requestId,
    projectId: record.projectId,
    organizationId: attribution.organizationId,
    teamId: attribution.teamId,
    requestType: INSTANT_EVAL_REQUEST_TYPE,
    model: INSTANT_EVAL_SPEND_MODEL,
    rateVersion: instantEvalRateVersion(pricing),
    inputTokens: record.inputTokens,
    // The CUSTOMER price, because that is the figure every consumer of the
    // ledger charges, caps and reports.
    costNanoUsd: usdToNanoUsd(record.priceUsd),
    metadata: instantEvalSpendMetadata(record),
    occurredAt: record.occurredAt.getTime(),
  };
}
