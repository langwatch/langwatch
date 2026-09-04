import type { ScenarioEvaluationResult } from "./schemas/event-schemas";

/** The verdict values a run holds, as ClickHouse stores them. */
export type GatedVerdict = "success" | "failure" | "inconclusive";

/**
 * Whether one evaluator result fails the run on its own: a required
 * evaluator that failed, or that errored before it could decide.
 */
export function evaluationFailsRun(evaluation: ScenarioEvaluationResult) {
  return (
    evaluation.required &&
    (evaluation.status === "failed" || evaluation.status === "error")
  );
}

/**
 * The verdict a run holds once its evaluators have run.
 *
 * A required evaluator that failed or errored turns the verdict to failure.
 * Otherwise the judge's verdict stands, and a run the judge never graded
 * stays ungraded. Scores and skipped results never gate.
 *
 * @see specs/scenarios/scenario-run-evaluations.feature
 */
export function gatedVerdict({
  evaluations,
  judgeVerdict,
}: {
  evaluations: ScenarioEvaluationResult[];
  judgeVerdict: GatedVerdict | undefined;
}): GatedVerdict | undefined {
  if (evaluations.some(evaluationFailsRun)) return "failure";
  return judgeVerdict;
}

/**
 * The status a run reads with after the gate.
 *
 * Only a run the judge graded moves: SUCCESS and FAILURE follow the gated
 * verdict. A run that errored, was cancelled or stalled never reached a
 * judgement, so its status stays what it was whatever the evaluators said.
 */
export function gatedStatus({
  status,
  verdict,
}: {
  status: string;
  verdict: GatedVerdict | undefined;
}): string {
  const judged = status === "SUCCESS" || status === "FAILURE";
  if (!judged || verdict === undefined) return status;
  return verdict === "success" ? "SUCCESS" : "FAILURE";
}
