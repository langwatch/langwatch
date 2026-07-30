import type { CriterionOutcome, TrendClassification } from "../report.types";

/**
 * What a criterion's history says about it.
 *
 * "Failing" on its own is not actionable — a criterion that has failed every
 * run since it was written needs a different response from one that passed
 * yesterday. The classification is what turns a red row into a decision.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

/**
 * Runs a criterion must have failed, consecutively, before we call it
 * long-standing rather than just currently failing. Below this it is
 * indistinguishable from a recent break.
 */
const MIN_APPEARANCES_FOR_LONG_STANDING = 3;

/**
 * Direction changes that mean "this criterion is not measuring anything
 * stable". Two, because one change is exactly what a regression or a fix looks
 * like — calling that unreliable would erase the two most useful verdicts.
 */
const MIN_FLIPS_FOR_UNRELIABLE = 2;

export interface TrendHistoryEntry {
  batchRunId: string;
  outcome: CriterionOutcome;
}

/**
 * Classifies a criterion from its history, oldest first, current run last.
 *
 * Order is load-bearing. "Unreliable" is tested before regression and fixed
 * because a criterion flapping back and forth is not regressing every time it
 * flips down — reporting that sends somebody hunting for a change that never
 * happened. A criterion nobody has seen before is not a regression either,
 * however it did this time.
 */
export function classifyTrend({ history }: { history: TrendHistoryEntry[] }): {
  classification: TrendClassification;
  streakBatches: number;
} {
  const appearances = history.filter((entry) => entry.outcome !== "absent");
  const current = appearances.at(-1)?.outcome;

  if (current === undefined) {
    return { classification: "new", streakBatches: 0 };
  }

  const streakBatches = countTrailingStreak(appearances);

  // Nothing to compare against: this criterion has only ever been seen once.
  if (appearances.length === 1) {
    return { classification: "new", streakBatches };
  }

  if (countFlips(appearances) >= MIN_FLIPS_FOR_UNRELIABLE) {
    return { classification: "unreliable", streakBatches };
  }

  const previous = appearances.at(-2)?.outcome;

  if (current === "unmet") {
    if (
      streakBatches >= MIN_APPEARANCES_FOR_LONG_STANDING &&
      streakBatches === appearances.length
    ) {
      return { classification: "long_standing", streakBatches };
    }
    return {
      classification: previous === "met" ? "regression" : "stable_fail",
      streakBatches,
    };
  }

  return {
    classification: previous === "unmet" ? "fixed" : "stable_pass",
    streakBatches,
  };
}

/** How many times the outcome changed direction across the history. */
function countFlips(appearances: TrendHistoryEntry[]): number {
  let flips = 0;
  for (let index = 1; index < appearances.length; index++) {
    if (appearances[index]!.outcome !== appearances[index - 1]!.outcome) {
      flips++;
    }
  }
  return flips;
}

/** Consecutive runs ending at the current one that share its outcome. */
function countTrailingStreak(appearances: TrendHistoryEntry[]): number {
  const current = appearances.at(-1)?.outcome;
  if (current === undefined) return 0;

  let streak = 0;
  for (let index = appearances.length - 1; index >= 0; index--) {
    if (appearances[index]!.outcome !== current) break;
    streak++;
  }
  return streak;
}
