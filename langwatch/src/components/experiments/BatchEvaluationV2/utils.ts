import type { ESBatchEvaluation } from "../../../server/experiments/types";

/**
 * Infer evaluation input/result column sets from a list of results.
 * Single Responsibility: derive columns used by UI and CSV builders.
 */
export function getEvaluationColumns(
  results: ESBatchEvaluation["evaluations"]
): {
  evaluationInputsColumns: Set<string>;
  evaluationResultsColumns: Set<string>;
} {
  const evaluationInputsColumns = new Set(
    results.flatMap((result) => Object.keys(result.inputs ?? {}))
  );
  const evaluatorResultsColumnsMap = {
    passed: false,
    score: false,
    label: false,
    details: false,
  };
  for (const result of results) {
    if (result.score !== undefined && result.score !== null) {
      evaluatorResultsColumnsMap.score = true;
    }
    if (result.passed !== undefined && result.passed !== null) {
      evaluatorResultsColumnsMap.passed = true;
    }
    if (result.label !== undefined && result.label !== null) {
      evaluatorResultsColumnsMap.label = true;
    }
    if (result.details !== undefined && result.details !== null) {
      evaluatorResultsColumnsMap.details = true;
    }
  }
  if (
    !evaluatorResultsColumnsMap.passed &&
    !evaluatorResultsColumnsMap.score &&
    !evaluatorResultsColumnsMap.label
  ) {
    evaluatorResultsColumnsMap.score = true;
  }
  const evaluationResultsColumns = new Set(
    Object.entries(evaluatorResultsColumnsMap)
      .filter(([_key, value]) => value)
      .map(([key]) => key)
  );

  return {
    evaluationInputsColumns,
    evaluationResultsColumns,
  };
}


