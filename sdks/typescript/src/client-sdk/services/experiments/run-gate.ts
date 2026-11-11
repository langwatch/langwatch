import type { ExperimentRunSummary } from "./platformTypes";

/**
 * Evaluations that returned a failing verdict across a completed run, summed from the
 * per-evaluator tallies. The server leaves `totalFailed` unset so released clients keep
 * their cell-based exit gate; this is what the opt-in evaluator gate reads instead.
 */
export function failedEvaluationsOf(summary: ExperimentRunSummary | undefined): number {
  return (summary?.evaluators ?? []).reduce((sum, evaluator) => sum + evaluator.failed, 0);
}
