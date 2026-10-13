/**
 * The judge's $1 check (ADR-174 decisions 8, 12): only an organization the meter bills judges
 * without a cap; every other one stops once its spend rows sum to a dollar. Integer nano-USD,
 * so no float decides it. Spec: modules/instant-eval/specs/instant-eval-judge-model.feature
 */

import { INSTANT_EVAL_FREE_BUDGET_USD } from "@langwatch/instant-eval-judge-contract";

const NANO_USD_PER_USD = 1_000_000_000n;

const INSTANT_EVAL_JUDGE_FREE_BUDGET_NANO_USD =
  BigInt(INSTANT_EVAL_FREE_BUDGET_USD) * NANO_USD_PER_USD;

/** Whether a judge call may classify, and what was spent when it may not. */
type InstantEvalJudgeBudget =
  | Readonly<{ outcome: "uncapped" }>
  | Readonly<{ outcome: "within" }>
  | Readonly<{ outcome: "exhausted"; spentUsd: number }>;

/** A call is admitted strictly under the dollar; the one that crosses it is recorded in full. */
export function instantEvalJudgeBudgetOf({
  usageBilled,
  spentNanoUsd,
}: {
  usageBilled: boolean;
  spentNanoUsd: bigint;
}): InstantEvalJudgeBudget {
  if (usageBilled) return { outcome: "uncapped" };
  if (spentNanoUsd < INSTANT_EVAL_JUDGE_FREE_BUDGET_NANO_USD) return { outcome: "within" };
  return { outcome: "exhausted", spentUsd: Number(spentNanoUsd) / Number(NANO_USD_PER_USD) };
}
