import { ScenarioRunStatus } from "./scenario-run.ts";
import type { ScenarioEvaluationResult } from "./schemas/event-schemas.ts";

/** The verdict values a run holds, as ClickHouse stores them. */
export type GatedVerdict = "success" | "failure" | "inconclusive";

/**
 * Whether one evaluator result fails the run on its own: a required
 * evaluator that failed, or that errored before it could decide.
 */
export function evaluationFailsRun(evaluation: ScenarioEvaluationResult): boolean {
  return evaluation.required && (evaluation.status === "failed" || evaluation.status === "error");
}

/** Returns verdict after evaluations; required failures or errors return
 * "failure", otherwise judge's verdict.
 */
export function computeGatedVerdict({
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
 * The status a run reads with after the gate. Only a judged run moves:
 * SUCCESS and FAILURE follow the gated verdict. An errored, cancelled or
 * stalled run never reached judgement, so its status stays as it was.
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

/** Checks whether a finished run still owes evaluator results; false if
 * already graded, cancelled, or errored.
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
