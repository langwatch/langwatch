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
    evaluations.length > 0 && evaluations.every((check) => check.status === "skipped");
  const processed = evaluations.filter((check) => check.status === "processed");
  const failed = processed.filter((check) => evaluationPassed(check) === false).length;

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

const skippedSuffix = (summary: EvaluationsTagSummary): string =>
  summary.skipped > 0 ? `, ${summary.skipped} skipped` : "";

const erroredSuffix = (summary: EvaluationsTagSummary): string =>
  summary.errored > 0 ? `, ${summary.errored} errored` : "";

/**
 * The evaluations tag label for a trace row. Every terminal state stays
 * visible — a failed label never hides errored or skipped runs, so the tag
 * always reconciles with the popover list it sits above (#6835).
 */
export function evaluationsTagLabel(summary: EvaluationsTagSummary): string {
  if (!summary.done) {
    // Still running: passes so far out of every evaluation on the trace —
    // terminal and in-flight alike.
    return `${summary.passes}/${summary.total} evaluations`;
  }
  if (summary.hasOnlySkippedRuns) return "Evaluations skipped";
  if (summary.failed > 0) {
    const noun = summary.failed === 1 ? "evaluation" : "evaluations";
    return `${summary.failed} ${noun} failed${erroredSuffix(summary)}${skippedSuffix(summary)}`;
  }
  if (summary.errored > 0) {
    // A crashed evaluator is not a fail verdict — label it as an error
    // instead of folding it into "failed".
    const noun = summary.errored === 1 ? "evaluation" : "evaluations";
    return `${summary.errored} ${noun} errored${skippedSuffix(summary)}`;
  }
  return `${summary.passes}/${summary.verdictTotal} evaluations${skippedSuffix(summary)}`;
}

/**
 * The guardrails tag label — same shape as {@link evaluationsTagLabel}: a
 * skipped or errored guardrail is neither a pass nor a block, and no count
 * hides another.
 */
export function guardrailsTagLabel(summary: EvaluationsTagSummary): string {
  if (!summary.done) {
    return `${summary.passes}/${summary.total} guardrails`;
  }
  if (summary.hasOnlySkippedRuns) return "Guardrails skipped";
  if (summary.failed > 0) {
    const noun = summary.failed === 1 ? "guardrail block" : "guardrail blocks";
    return `${summary.failed} ${noun}${erroredSuffix(summary)}${skippedSuffix(summary)}`;
  }
  if (summary.errored > 0) {
    const noun = summary.errored === 1 ? "guardrail" : "guardrails";
    return `${summary.errored} ${noun} errored${skippedSuffix(summary)}`;
  }
  return `${summary.passes}/${summary.verdictTotal} guardrails${skippedSuffix(summary)}`;
}
