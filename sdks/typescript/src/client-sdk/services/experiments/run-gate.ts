import type { ExperimentRunSummary } from "./platformTypes";

/**
 * Failed and crashed evaluations summed from the per-evaluator tallies. A crashed
 * evaluator checked nothing, so it counts against the opt-in gate. The server leaves
 * `totalFailed` unset so released clients keep their cell-based exit gate.
 */
export function evaluatorFailuresOf(summary: ExperimentRunSummary | undefined): {
  failed: number;
  errored: number;
} {
  return (summary?.evaluators ?? []).reduce(
    (sum, evaluator) => ({
      failed: sum.failed + evaluator.failed,
      errored: sum.errored + (evaluator.errored ?? 0),
    }),
    { failed: 0, errored: 0 },
  );
}

/** Failed plus errored evaluations: what the opt-in gate fails the job on. */
export function failedEvaluationsOf(summary: ExperimentRunSummary | undefined): number {
  const { failed, errored } = evaluatorFailuresOf(summary);
  return failed + errored;
}
