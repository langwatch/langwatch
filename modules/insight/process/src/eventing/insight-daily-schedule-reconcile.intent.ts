/**
 * The reconcile pass's one piece of work: arm every schedule that is on and has no wake. The
 * outbox may deliver it twice, and a pass carried out twice asks each schedule once.
 */

import { z } from "zod";

export const INSIGHT_SCHEDULE_RECONCILE_INTENT = "reconcileSchedules" as const;

/** A pass reads every schedule that is on: long enough that no second pod takes it meanwhile. */
export const INSIGHT_SCHEDULE_RECONCILE_LEASE_MS = 10 * 60_000;

/** The next hourly pass repeats the work, so a failed one is not worth many tries. */
export const INSIGHT_SCHEDULE_RECONCILE_MAX_ATTEMPTS = 2;

export const reconcileSchedulesIntentSchema = z.object({
  /** The instant the pass was due: it names the pass. */
  scheduledFor: z.number().int().nonnegative(),
});
type ReconcileSchedulesIntent = z.infer<typeof reconcileSchedulesIntentSchema>;

/** Carries out one pass; late-bound to the service the module composes. */
export interface InsightDailyScheduleReconciler {
  reconcile(input: { passAt: number }): Promise<{ repaired: number }>;
}

export function reconcileSchedulesIntent({
  schedules,
}: {
  schedules: InsightDailyScheduleReconciler;
}): (payload: ReconcileSchedulesIntent) => Promise<void> {
  return async ({ scheduledFor }) => {
    await schedules.reconcile({ passAt: scheduledFor });
  };
}
