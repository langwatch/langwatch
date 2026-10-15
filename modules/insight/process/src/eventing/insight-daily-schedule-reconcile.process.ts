/**
 * The reconcile pass, hourly and once across the fleet: a scheduled singleton on the daily run
 * pipeline that hands one pass to the outbox on each wake.
 * @see modules/insight/adrs/004-daily-run.md
 */

import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

import {
  INSIGHT_SCHEDULE_RECONCILE_INTENT,
  type reconcileSchedulesIntentSchema,
} from "./insight-daily-schedule-reconcile.intent.ts";

export const INSIGHT_SCHEDULE_RECONCILE_PROCESS_NAME = "dailyInsightsScheduleReconcile" as const;

/** A schedule silenced by a deploy or a lost wake is armed again within the hour. */
export const INSIGHT_SCHEDULE_RECONCILE_INTERVAL_MS = 60 * 60_000;

export const insightScheduleReconcileStateSchema = z.object({
  lastPassAt: z.number().nullable(),
});
type InsightScheduleReconcileState = z.infer<typeof insightScheduleReconcileStateSchema>;

export const INITIAL_INSIGHT_SCHEDULE_RECONCILE_STATE: InsightScheduleReconcileState = {
  lastPassAt: null,
};

type InsightScheduleReconcileIntents = {
  [INSIGHT_SCHEDULE_RECONCILE_INTENT]: IntentSpec<typeof reconcileSchedulesIntentSchema>;
};

/** Keyed by the wake, so a redelivered wake asks for the pass once. */
export const insightScheduleReconcileWake: WakeHandler<
  InsightScheduleReconcileState,
  InsightScheduleReconcileIntents
> = (_state, context) => ({
  state: { lastPassAt: context.at },
  intents: [
    context.intent(INSIGHT_SCHEDULE_RECONCILE_INTENT, `pass:${context.at}`, {
      scheduledFor: context.at,
    }),
  ],
});
