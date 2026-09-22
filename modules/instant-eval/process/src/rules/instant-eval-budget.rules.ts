/**
 * One dollar across every project of an organization without a paid plan,
 * compared in the ledger's own integer nano-USD so no float decides it.
 * @see specs/instant-evals/instant-eval-billing.feature
 */

import { NANO_USD_PER_USD } from "./instant-eval-spend-outcome.rules.ts";

/** What an organization without a paid plan may spend on Instant Evals, in USD. */
export const INSTANT_EVAL_FREE_BUDGET_USD = 1;

export const INSTANT_EVAL_FREE_BUDGET_NANO_USD = INSTANT_EVAL_FREE_BUDGET_USD * NANO_USD_PER_USD;

/**
 * How long a reservation outlives its owner. Long enough for any run to finish
 * and land its spend; short enough that a run whose process died without
 * releasing does not hold the budget for good.
 */
export const INSTANT_EVAL_RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;

/** Where the budget stands for one organization. */
export interface InstantEvalFreeBudgetStanding {
  /** Whether the organization is bounded by the free budget at all. */
  readonly isFree: boolean;
  readonly spentUsd: number;
  readonly budgetUsd: number;
  /** What is left, or null for a paid organization, which has no budget. */
  readonly remainingUsd: number | null;
}

/** The standing of anything the free budget does not bound. */
export function paidInstantEvalStanding(): InstantEvalFreeBudgetStanding {
  return {
    isFree: false,
    spentUsd: 0,
    budgetUsd: INSTANT_EVAL_FREE_BUDGET_USD,
    remainingUsd: null,
  };
}

/** The standing of a free organization that has spent this much. */
export function freeInstantEvalStanding({
  spentNanoUsd,
}: {
  spentNanoUsd: number;
}): InstantEvalFreeBudgetStanding {
  return {
    isFree: true,
    spentUsd: spentNanoUsd / NANO_USD_PER_USD,
    budgetUsd: INSTANT_EVAL_FREE_BUDGET_USD,
    remainingUsd: instantEvalBudgetRoomNanoUsd({ spentNanoUsd }) / NANO_USD_PER_USD,
  };
}

/** What a new hold may take, in nano-USD, once the ledger is counted. */
export function instantEvalBudgetRoomNanoUsd({ spentNanoUsd }: { spentNanoUsd: number }): number {
  return Math.max(0, INSTANT_EVAL_FREE_BUDGET_NANO_USD - spentNanoUsd);
}

/**
 * What the organization has committed to Instant Evals: the ledger, plus what
 * is held for work that has not reached it, plus what the caller has spent
 * since its own hold was taken.
 */
export function instantEvalCommittedUsd({
  spentNanoUsd,
  heldNanoUsd,
  inFlightUsd = 0,
}: {
  spentNanoUsd: number;
  heldNanoUsd: number;
  inFlightUsd?: number;
}): number {
  return (spentNanoUsd + heldNanoUsd) / NANO_USD_PER_USD + inFlightUsd;
}

/** Whether that commitment is still under the budget, strictly. */
export function isWithinInstantEvalBudget({ committedUsd }: { committedUsd: number }): boolean {
  return INSTANT_EVAL_FREE_BUDGET_USD > committedUsd;
}
