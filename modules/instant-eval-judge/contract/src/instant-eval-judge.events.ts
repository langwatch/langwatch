/**
 * The judge's own fact: one judge call priced, on the organization's aggregate (ADR-174 decision
 * 13). The judge writes it as one spend row per request, and gateway writes the ledger row the
 * meter reads, so a repeat under the same request id is one row on each side.
 */
import { z } from "zod";

export const INSTANT_EVAL_JUDGE_SPEND_PIPELINE_NAME = "instant_eval_judge_spend" as const;
export const INSTANT_EVAL_JUDGE_SPEND_AGGREGATE_TYPE = "instant_eval_judge_spend" as const;
export const INSTANT_EVAL_JUDGE_SPEND_PRICED_EVENT_TYPE =
  "lw.instant_eval_judge.spend_priced" as const;
export const INSTANT_EVAL_JUDGE_SPEND_EVENT_VERSION = "2026-10-07" as const;

export const instantEvalJudgeSpendPricedEventDataSchema = z.object({
  /** The organization, which the aggregate and its tenant are. */
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  /** One per judged request; the same retry key gives the same id (ADR-174 decision 9). */
  requestId: z.string().min(1),
  model: z.string().min(1),
  /** The two published numbers the price came from, so a replay is told from a re-rating. */
  rateVersion: z.string().min(1),
  inputTokens: z.number().int().positive(),
  /** The customer price in integer nano-USD: what the spend row, the ledger and the meter carry. */
  priceNanoUsd: z.number().int().nonnegative(),
  /** What the classifier charged us, in integer nano-USD, kept beside the price. */
  costNanoUsd: z.number().int().nonnegative(),
  /** Classifications the tokens came from: one for a judge call, many for a run or query. */
  requests: z.number().int().positive().optional(),
  /** The run a run's spend belongs to, so the ledger row names it. */
  runId: z.string().min(1).optional(),
});
export type InstantEvalJudgeSpendPricedEventData = z.infer<
  typeof instantEvalJudgeSpendPricedEventDataSchema
>;
