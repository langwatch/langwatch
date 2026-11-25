// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

/** M8487-RECONCILE-PM: one instance per aggregate reconciles it; the daily wake only prunes. */
export const AGGREGATE_RECONCILE_PROCESS_NAME = "aggregateProjectReconcile" as const;
export const AGGREGATE_RECONCILE_INTENT = "reconcile" as const;
/** Wire name kept from the sweep, so a sweep queued before the deploy still runs (as a prune). */
export const AGGREGATE_PRUNE_INTENT = "sweep" as const;
/** Clears finished reconciles; reconciles come from facts alone (ADR-177, ADR-025). */
export const AGGREGATE_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const AGGREGATE_RECONCILE_MAX_ATTEMPTS = 5;
/** Dispatched rows older than this are pruned; dead ones stay for an operator. */
export const AGGREGATE_RECONCILE_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

export const aggregateReconcileIntentSchema = z.object({
  organizationId: z.string().min(1),
  aggregateProjectId: z.string().min(1),
});
export type AggregateReconcileIntent = z.infer<typeof aggregateReconcileIntentSchema>;

export const aggregatePruneIntentSchema = z.object({ scheduledFor: z.number().int() });

/** A state stored before the prune existed carries none, so it reads as never pruned. */
export const aggregateReconcileStateSchema = z.object({
  lastPruneAt: z.number().nullable().default(null),
});
type AggregateReconcileState = z.infer<typeof aggregateReconcileStateSchema>;
export const AGGREGATE_RECONCILE_INITIAL_STATE: AggregateReconcileState = { lastPruneAt: null };

type AggregateReconcileIntents = {
  [AGGREGATE_RECONCILE_INTENT]: IntentSpec<typeof aggregateReconcileIntentSchema>;
  [AGGREGATE_PRUNE_INTENT]: IntentSpec<typeof aggregatePruneIntentSchema>;
};

/** The process instance one aggregate's reconciles queue on. */
export function aggregateReconcileProcessKey({
  aggregateProjectId,
}: {
  aggregateProjectId: string;
}): string {
  return `aggregate:${aggregateProjectId}`;
}

/** Every wake asks for one prune, keyed by its schedule time so a redelivery is a repeat. */
export const aggregatePruneWake: WakeHandler<AggregateReconcileState, AggregateReconcileIntents> = (
  _state,
  ctx,
) => ({
  state: { lastPruneAt: ctx.at },
  intents: [ctx.intent(AGGREGATE_PRUNE_INTENT, `prune:${ctx.at}`, { scheduledFor: ctx.at })],
});
