/**
 * What one Instant Eval's spend looks like on the gateway spend spine.
 *
 * A judged query or run is one confirmed outcome on the `gateway_request`
 * aggregate, with no admission in front of it. The spine already accepts an
 * outcome that states its own attribution (a brokered voice session is
 * confirmed by the control plane before its admission lands), and a judgement
 * has no in-flight phase worth admitting: by the time anything is known about
 * it, it is over. So the fold, the budget debits and the webhook envelope all
 * read this one event, and the settlement sweeper, which only resolves open
 * admissions, never sees it.
 *
 * Money is priced here, once, the way the ingest seam prices a gateway
 * outcome: the record's `cost_nano_usd` is the CUSTOMER price, because that
 * is the figure every consumer of the ledger charges, caps and reports. Our
 * own cost and the request count ride the metadata beside it, so the margin
 * is recoverable from the row without recomputing a rate that will change.
 *
 * @see ../../../event-sourcing/pipelines/gateway-spend-processing/schemas/commands.ts
 * @see ../../../../../../specs/instant-evals/instant-eval-billing.feature
 */

import { generate } from "@langwatch/ksuid";

import type { ConfirmSpendCommandData } from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/commands";
import { EMPTY_SPEND_USAGE } from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/commands";
import { NANO_USD_PER_USD } from "~/server/event-sourcing/pipelines/gateway-spend-processing/services/spend-rating.service";
import { KSUID_RESOURCES } from "~/utils/constants";
import type { InstantEvalPricing } from "../classifier/classifier";
import { INSTANT_EVAL_PRICING } from "../classifier/pricing";
import { INSTANT_EVAL_REQUEST_TYPE } from "./request-type";

/** The model the ledger names for a judgement: the shipped classifier. */
export const INSTANT_EVAL_SPEND_MODEL = "jev";

/** The prefix a run's request id carries, so the id is the run's own. */
const RUN_REQUEST_ID_PREFIX = "instanteval_";

/** What the spend spine needs to know about one query or run. */
export interface InstantEvalSpendOutcomeInput {
  readonly projectId: string;
  readonly organizationId: string;
  readonly teamId: string;
  /** Absent for a synchronous query. */
  readonly runId?: string;
  /**
   * The gateway key the judgements were made under. Set for a hosted call,
   * where the key is the managed key of a self-hosted license and names the
   * install. Absent for a query or a run inside LangWatch Cloud.
   */
  readonly virtualKeyId?: string;
  readonly inputTokens: number;
  readonly requests: number;
  /** What the classifier charged us, in USD. */
  readonly costUsd: number;
  /** What the customer is charged, in USD. */
  readonly priceUsd: number;
  readonly occurredAt: Date;
}

/**
 * The request id the outcome is addressed by.
 *
 * A run's id is derived from the run, so a finish delivered twice appends the
 * same request and the event store drops the second under the spine's own
 * `(tenant, request, step)` idempotency key. A synchronous query has no durable
 * resource to derive one from, so it mints a fresh one and a retry is a second
 * query, which is what it is.
 */
export function instantEvalSpendRequestId({
  runId,
}: {
  runId?: string;
}): string {
  return runId
    ? `${RUN_REQUEST_ID_PREFIX}${runId}`
    : generate(KSUID_RESOURCES.INSTANT_EVAL_QUERY).toString();
}

/**
 * The rate identity stamped on the outcome.
 *
 * The gateway stamps the model registry's date; a judgement has no registry,
 * so it stamps the two published numbers it was priced with. A price change
 * changes the stamp, which is what lets a replay be told apart from a
 * re-rating.
 */
export function instantEvalRateVersion(
  pricing: InstantEvalPricing = INSTANT_EVAL_PRICING,
): string {
  return `instant_eval@${pricing.usdPerMillionInputTokens}x${pricing.markup}`;
}

/** USD to integer nano-USD, rounded once. */
export function usdToNanoUsd(usd: number): number {
  return Math.round(usd * NANO_USD_PER_USD);
}

/** The metadata JSON the row carries beside the price. */
export function instantEvalSpendMetadata(
  input: Pick<InstantEvalSpendOutcomeInput, "costUsd" | "requests" | "runId">,
): string {
  return JSON.stringify({
    instant_eval: {
      cost_usd: input.costUsd,
      requests: input.requests,
      ...(input.runId ? { run_id: input.runId } : {}),
    },
  });
}

/** The confirmed outcome one query or run appends. */
export function instantEvalSpendOutcome({
  input,
  requestId,
  pricing = INSTANT_EVAL_PRICING,
}: {
  input: InstantEvalSpendOutcomeInput;
  requestId: string;
  pricing?: InstantEvalPricing;
}): ConfirmSpendCommandData {
  return {
    gateway_request_id: requestId,
    occurred_at: input.occurredAt.getTime(),
    tenantId: input.projectId,
    model: INSTANT_EVAL_SPEND_MODEL,
    model_provider_id: "",
    usage: { ...EMPTY_SPEND_USAGE, input_tokens: input.inputTokens },
    rate_version: instantEvalRateVersion(pricing),
    duration_ms: 0,
    organization_id: input.organizationId,
    virtual_key_id: input.virtualKeyId ?? "",
    end_user_id: "",
    trace_id: "",
    request_type: INSTANT_EVAL_REQUEST_TYPE,
    labels: [],
    metadata: instantEvalSpendMetadata(input),
    admitted_at: 0,
    cost_nano_usd: usdToNanoUsd(input.priceUsd),
    principal_user_id: "",
    team_id: input.teamId,
  };
}
