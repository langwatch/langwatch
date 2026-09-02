/**
 * What a verdict MEANS, apart from what it looks like.
 *
 * `evaluationPassed` and `evaluationStatusColor` are read by a count, by a
 * trace tag and by a status icon, and only the last of the three renders
 * anything. They sit in `model` so `evaluation-summary-counts` can read them:
 * a pure counter may depend on pure vocabulary and never on an element.
 */

import type { ElasticSearchEvaluation } from "@langwatch/trace-contract";

/** As much of an evaluation as any of these readings needs. */
export type EvaluationVerdictReading = Pick<ElasticSearchEvaluation, "status" | "passed" | "score">;

export const evaluationStatusColor = (check: EvaluationVerdictReading) => {
  const colorMap: Record<ElasticSearchEvaluation["status"], string> = {
    scheduled: "status.pending",
    in_progress: "status.pending",
    error: "status.error",
    skipped: "status.warning",
    processed: evaluationPassed(check) === false ? "status.error" : "status.success",
  };

  return colorMap[check.status];
};

export const evaluationPassed = (evaluation: EvaluationVerdictReading) => {
  if (evaluation.status !== "processed") {
    return undefined;
  }

  if (evaluation.passed !== undefined && evaluation.passed !== null) {
    return evaluation.passed;
  }

  // TODO: replace this heuristic of .score != 0 with proper threshold definitions on the evaluators
  if (evaluation.score && evaluation.score < 0.3) {
    return false;
  }

  return true;
};
