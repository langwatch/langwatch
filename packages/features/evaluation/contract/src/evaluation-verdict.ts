/**
 * A verdict (passed/score) is only real when the evaluator actually ran to
 * completion. Producers may attach `passed: false` alongside `status:
 * "error"` (the SDKs expose them as independent params), and an errored
 * run's verdict must not reach analytics, triggers, or stored rows as a
 * real fail (#6833).
 *
 * Shared by BOTH evaluation folds (`evaluationRun` and the slim
 * `evaluationAnalytics`) and the executeEvaluation command's emit path, so
 * the documented parity invariant — the slim row matches `evaluation_runs`
 * to the cent for the shared fields — holds by construction.
 */

export type TerminalEvaluationStatus = "processed" | "error" | "skipped";

export function verdictPassedOf(data: {
  status: TerminalEvaluationStatus;
  passed?: boolean | null;
}): boolean | null {
  return data.status === "processed" ? (data.passed ?? null) : null;
}

export function verdictScoreOf(data: {
  status: TerminalEvaluationStatus;
  score?: number | null;
}): number | null {
  if (data.status !== "processed") return null;
  return typeof data.score === "number" ? data.score : null;
}
