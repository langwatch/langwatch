/**
 * What a verdict MEANS, apart from what it looks like. `evaluationPassed`
 * and `evaluationStatusColor` feed a count, a trace tag and a status icon,
 * kept here so a pure counter depends on vocabulary, never an element.
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
