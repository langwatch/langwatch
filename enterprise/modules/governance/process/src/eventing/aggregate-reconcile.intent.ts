// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentExecutor, ProcessStore } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { AggregateReconcilerService } from "../services/aggregate-reconciler.service.ts";
import {
  AGGREGATE_RECONCILE_INTENT,
  AGGREGATE_RECONCILE_PROCESS_NAME,
  AGGREGATE_RECONCILE_RETENTION_MS,
  type AggregateReconcileIntent,
  type AggregateSweepIntent,
  aggregateReconcileProcessKey,
} from "./aggregate-reconcile.process.ts";

/** Enqueues one reconcile per aggregate on its own process instance; `cause` makes the key. */
export class OutboxAggregateReconcile {
  static create(processStore: Pick<ProcessStore, "appendIntents">): OutboxAggregateReconcile {
    return new OutboxAggregateReconcile(processStore);
  }

  private constructor(private readonly processStore: Pick<ProcessStore, "appendIntents">) {}

  async enqueue({
    organizationId,
    aggregateProjectIds,
    cause,
  }: {
    organizationId: string;
    aggregateProjectIds: readonly string[];
    cause: string;
  }): Promise<void> {
    for (const aggregateProjectId of aggregateProjectIds) {
      await this.processStore.appendIntents({
        ref: {
          processName: AGGREGATE_RECONCILE_PROCESS_NAME,
          projectId: organizationId,
          processKey: aggregateReconcileProcessKey({ aggregateProjectId }),
        },
        tenantId: organizationId,
        sourceEventId: null,
        messages: [
          {
            messageKey: `reconcile:${aggregateProjectId}:${cause}`,
            intentType: AGGREGATE_RECONCILE_INTENT,
            payload: { organizationId, aggregateProjectId },
            traceCarrier: {},
          },
        ],
        now: nowInstant().epochMilliseconds,
      });
    }
  }
}

/** The reconcile intent: one aggregate, under its lock; a throw spends a rung of the outbox ladder. */
export function runAggregateReconcile(
  reconciler: Pick<AggregateReconcilerService, "reconcile">,
): IntentExecutor<AggregateReconcileIntent> {
  return async ({ aggregateProjectId }) => {
    await reconciler.reconcile({ aggregateProjectId });
  };
}

/** The sweep intent: a reconcile enqueued for every live aggregate, then old rows pruned. */
export function runAggregateSweep({
  reconciler,
  outbox,
  deleteDispatchedBefore,
  now,
}: {
  reconciler: Pick<AggregateReconcilerService, "liveAggregates">;
  outbox: Pick<OutboxAggregateReconcile, "enqueue">;
  deleteDispatchedBefore: ProcessStore["deleteDispatchedBefore"];
  now: () => number;
}): IntentExecutor<AggregateSweepIntent> {
  return async ({ scheduledFor }) => {
    for (const { id, organizationId } of await reconciler.liveAggregates()) {
      await outbox.enqueue({
        organizationId,
        aggregateProjectIds: [id],
        cause: `sweep:${scheduledFor}`,
      });
    }
    await deleteDispatchedBefore({
      processName: AGGREGATE_RECONCILE_PROCESS_NAME,
      before: now() - AGGREGATE_RECONCILE_RETENTION_MS,
    });
  };
}
