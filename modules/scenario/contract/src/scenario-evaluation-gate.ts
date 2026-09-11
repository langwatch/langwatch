import { ScenarioRunStatus } from "./scenario-run.ts";
import type { ScenarioEvaluationResult } from "./schemas/event-schemas.ts";

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
  if (judgeVerdict === undefined) return undefined;
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

/** The statuses a finished run can hold with no conversation to grade. */
export const UNGRADED_RUN_STATUSES: ReadonlySet<string> = new Set([
  ScenarioRunStatus.ERROR,
  ScenarioRunStatus.CANCELLED,
]);

/**
 * Whether a run that has just finished still owes evaluator results.
 *
 * A run whose own results carry evaluations was graded by the code that ran
 * it. A run that errored or was cancelled has nothing to grade. Everything
 * else owes one result per attachment it was queued with.
 *
 * The fold, the subscriber that queues the job and the process manager that
 * watches for a lost job all read this, so the status a run is stored with,
 * the work queued for it and the deadline armed for it cannot disagree.
 *
 * It lives beside the gate rather than beside the run's evaluator payload
 * because the payload's schemas need an evaluator definition this package
 * does not depend on, and the fold needs this predicate today.
 *
 * @see specs/scenarios/scenario-evaluation-pending.feature
 */
export function runAwaitsEvaluations({
  status,
  hasOwnEvaluations,
  attachmentCount,
}: {
  status: string | undefined;
  hasOwnEvaluations: boolean;
  attachmentCount: number;
}): boolean {
  if (hasOwnEvaluations) return false;
  if (status && UNGRADED_RUN_STATUSES.has(status)) return false;
  return attachmentCount > 0;
}
