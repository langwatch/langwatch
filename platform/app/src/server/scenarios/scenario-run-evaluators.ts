/**
 * The evaluators one scenario run is graded with, and whether it still owes
 * their results.
 *
 * The set is resolved once, when the run is queued, and travels on the run's
 * own events: queued carries it, finished carries it forward, the evaluation
 * job payload carries it to the worker. Nothing downstream reads the suite or
 * the run plan again, so editing either while a batch is executing changes the
 * next runs and never the ones already queued, and a retry of the evaluation
 * job grades exactly what the first attempt would have.
 *
 * A finished run that owes results reads with the status PENDING_EVALUATION
 * until they are recorded. The stored status stays the terminal one the judge
 * decided; the pending status is derived at read time and expires with
 * {@link EVALUATION_PENDING_GRACE_MS}, so a job that never completes cannot
 * hold a run open for good.
 *
 * @see specs/scenarios/scenario-evaluation-pending.feature
 */

import { z } from "zod";
import { evaluatorAttachmentsSchema } from "./evaluator-attachments";
import { ScenarioRunStatus } from "./scenario-event.enums";

/** The evaluator attachments a run was queued with, and where they came from. */
export const runEvaluatorsSchema = z.object({
  /** The scenario's test suite, when it is filed in one. */
  suiteId: z.string().nullable(),
  /** The run plan the run was filed under, when it was. */
  planId: z.string().nullable(),
  attachments: evaluatorAttachmentsSchema,
});
export type RunEvaluators = z.infer<typeof runEvaluatorsSchema>;

/**
 * How long a finished run may report PENDING_EVALUATION.
 *
 * The job retries for about three minutes while the trace arrives and then
 * grades, and an evaluator is one model call per attachment, so the window is
 * generous. Past it the run reports the status the judge decided: a job that
 * is never coming back is a failure to grade, not a reason to leave every
 * waiter hanging.
 */
export const EVALUATION_PENDING_GRACE_MS = 15 * 60 * 1000;

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
 * The fold and the subscriber that queues the job both read this, so the
 * status a run reports and the work actually queued for it cannot disagree.
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

/**
 * Whether a stored run should be reported as awaiting evaluation, given how
 * long ago it finished.
 */
export function evaluationIsStillPending({
  awaitsEvaluation,
  finishedAt,
  now,
}: {
  awaitsEvaluation: boolean;
  finishedAt: number | null;
  now: number;
}): boolean {
  if (!awaitsEvaluation || finishedAt == null) return false;
  return now - finishedAt < EVALUATION_PENDING_GRACE_MS;
}
