import type { ElasticSearchEvaluation } from "~/server/tracer/types";
import { evaluationPassed } from "./EvaluationStatus";

/**
 * Verdict-aware counts for a trace's evaluations (#6835).
 *
 * Three states must stay apart:
 *   - a verdict (processed pass/fail),
 *   - "ran and found nothing to judge" (skipped),
 *   - "the evaluator broke" (error).
 *
 * The messages-list tag previously counted skipped runs as passes and
 * errored runs as fails; both invent a verdict nobody produced.
 */
export interface EvaluationsTagSummary {
  /** Every evaluation reached a terminal status. */
  done: boolean;
  /** Every evaluation was skipped — "nothing to evaluate", not a verdict. */
  hasOnlySkippedRuns: boolean;
  /** Every evaluation on the trace, whatever its state. */
  total: number;
  /** Processed runs — the only ones that can carry a verdict. */
  verdictTotal: number;
  /** Processed runs that did not fail (includes score-only neutrals). */
  passes: number;
  /** Processed runs with an explicit fail verdict. */
  failed: number;
  /** Runs whose evaluator crashed — an infrastructure state, not a fail. */
  errored: number;
  /** Runs that were skipped — neither passed nor failed. */
  skipped: number;
}

export function summarizeEvaluationsTag(
  evaluations: Pick<ElasticSearchEvaluation, "status" | "passed" | "score">[],
): EvaluationsTagSummary {
  const done = evaluations.every(
    (check) =>
      check.status === "processed" ||
      check.status === "skipped" ||
      check.status === "error",
  );
  const hasOnlySkippedRuns =
    evaluations.length > 0 &&
    evaluations.every((check) => check.status === "skipped");
  const processed = evaluations.filter((check) => check.status === "processed");
  const failed = processed.filter(
    (check) => evaluationPassed(check) === false,
  ).length;

  return {
    done,
    hasOnlySkippedRuns,
    total: evaluations.length,
    verdictTotal: processed.length,
    passes: processed.length - failed,
    failed,
    errored: evaluations.filter((check) => check.status === "error").length,
    skipped: evaluations.filter((check) => check.status === "skipped").length,
  };
}
