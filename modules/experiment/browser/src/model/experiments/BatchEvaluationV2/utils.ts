import type { ExperimentRunWithItems } from "@langwatch/experiment-contract";

/**
 * Infer evaluation input/result column sets from a list of results.
 * Single Responsibility: derive columns used by UI and CSV builders.
 */
/** One key of an object read without knowing its shape; `undefined` for anything else. */
export const readKey = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null
    ? Object.entries(value).find(([entryKey]) => entryKey === key)?.[1]
    : undefined;

/** A cell value as text: strings as they are, other scalars printed, anything else as JSON. */
export const cellText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value === undefined) return "";
  return JSON.stringify(value) ?? "";
};

export function getEvaluationColumns(results: ExperimentRunWithItems["evaluations"]): {
  evaluationInputsColumns: Set<string>;
  evaluationResultsColumns: Set<string>;
} {
  const evaluationInputsColumns = new Set(
    results.flatMap((result) => Object.keys(result.inputs ?? {})),
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
      .map(([key]) => key),
  );

  return {
    evaluationInputsColumns,
    evaluationResultsColumns,
  };
}
