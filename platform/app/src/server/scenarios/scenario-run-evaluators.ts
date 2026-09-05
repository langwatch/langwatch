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
 * A finished run that owes results is stored with the status
 * PENDING_EVALUATION, the way a scheduled run is stored QUEUED, until the
 * evaluated event records them and the gate writes the terminal status. A
 * grading job that is lost outright is recorded as errored evaluators by the
 * run execution process manager once its deadline passes, so a required
 * evaluator that never ran fails the run instead of leaving it pending.
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
