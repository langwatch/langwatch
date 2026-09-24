/**
 * A verdict (passed/score) is only real when the evaluator completed. Errored
 * runs' verdicts never reach analytics/triggers/stored rows. @see #6833
 */

export type TerminalEvaluationStatus = "processed" | "error" | "skipped";

export function deriveVerdictPassed(data: {
  status: TerminalEvaluationStatus;
  passed?: boolean | null;
}): boolean | null {
  return data.status === "processed" ? (data.passed ?? null) : null;
}

export function deriveVerdictScore(data: {
  status: TerminalEvaluationStatus;
  score?: number | null;
}): number | null {
  if (data.status !== "processed") return null;
  return typeof data.score === "number" ? data.score : null;
}
