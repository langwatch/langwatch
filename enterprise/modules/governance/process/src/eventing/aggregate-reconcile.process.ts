// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

/** M8487-RECONCILE-PM: one instance per aggregate reconciles it; the daily wake enqueues them all. */
export const AGGREGATE_RECONCILE_PROCESS_NAME = "aggregateProjectReconcile" as const;
export const AGGREGATE_RECONCILE_INTENT = "reconcile" as const;
export const AGGREGATE_SWEEP_INTENT = "sweep" as const;
/** Main's nightly catch-up for anything a trigger missed. */
export const AGGREGATE_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const AGGREGATE_RECONCILE_MAX_ATTEMPTS = 5;
/** Dispatched rows older than this are pruned by the sweep. */
export const AGGREGATE_RECONCILE_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

export const aggregateReconcileIntentSchema = z.object({
  organizationId: z.string().min(1),
  aggregateProjectId: z.string().min(1),
});
export type AggregateReconcileIntent = z.infer<typeof aggregateReconcileIntentSchema>;

export const aggregateSweepIntentSchema = z.object({ scheduledFor: z.number().int() });
export type AggregateSweepIntent = z.infer<typeof aggregateSweepIntentSchema>;

export const aggregateReconcileStateSchema = z.object({ lastSweepAt: z.number().nullable() });
type AggregateReconcileState = z.infer<typeof aggregateReconcileStateSchema>;
export const AGGREGATE_RECONCILE_INITIAL_STATE: AggregateReconcileState = { lastSweepAt: null };

type AggregateReconcileIntents = {
  [AGGREGATE_RECONCILE_INTENT]: IntentSpec<typeof aggregateReconcileIntentSchema>;
  [AGGREGATE_SWEEP_INTENT]: IntentSpec<typeof aggregateSweepIntentSchema>;
};

/** The process instance one aggregate's reconciles queue on. */
export function aggregateReconcileProcessKey({
  aggregateProjectId,
}: {
  aggregateProjectId: string;
}): string {
  return `aggregate:${aggregateProjectId}`;
}

/** Every wake asks for one sweep, keyed by its schedule time so a redelivery is a repeat. */
export const aggregateSweepWake: WakeHandler<AggregateReconcileState, AggregateReconcileIntents> = (
  _state,
  ctx,
) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intent(AGGREGATE_SWEEP_INTENT, `sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});
