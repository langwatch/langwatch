// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentExecutor, ProcessStore } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { AggregateReconcilerService } from "../services/aggregate-reconciler.service.ts";
import {
  AGGREGATE_RECONCILE_INTENT,
  AGGREGATE_RECONCILE_PROCESS_NAME,
  AGGREGATE_RECONCILE_RETENTION_MS,
  type AggregateReconcileIntent,
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

/**
 * One member's attach was refused while the rest went through — thrown to
 * spend a rung of the outbox ladder; a quiet return would mark the reconcile
 * finished with the aggregate short of a member, and no fact need ever come
 * again. A plain `Error`, not `HandledError`: nothing here reaches a customer.
 */
export class AggregateReconcileIncompleteError extends Error {
  readonly aggregateProjectId: string;
  readonly failed: readonly string[];

  constructor({
    aggregateProjectId,
    failed,
  }: {
    aggregateProjectId: string;
    failed: readonly string[];
  }) {
    super(
      `Aggregate ${aggregateProjectId} reconcile left ${failed.length} member(s) unattached: ${failed.join(", ")}; trying again`,
    );
    this.name = "AggregateReconcileIncompleteError";
    this.aggregateProjectId = aggregateProjectId;
    this.failed = failed;
  }
}

/**
 * The reconcile intent: one aggregate, under its lock; a throw spends a rung of the outbox
 * ladder. A refused attach throws too: the grants already attached read as held next time.
 */
export function runAggregateReconcile(
  reconciler: Pick<AggregateReconcilerService, "reconcile">,
): IntentExecutor<AggregateReconcileIntent> {
  return async ({ aggregateProjectId }) => {
    const { failed } = await reconciler.reconcile({ aggregateProjectId });
    if (failed.length > 0)
      throw new AggregateReconcileIncompleteError({ aggregateProjectId, failed });
  };
}

/** The prune intent: dispatched reconciles older than two days go; it queues no reconcile. */
export function runAggregatePrune({
  deleteDispatchedBefore,
  now,
}: {
  deleteDispatchedBefore: ProcessStore["deleteDispatchedBefore"];
  now: () => number;
}): () => Promise<void> {
  return async () => {
    await deleteDispatchedBefore({
      processName: AGGREGATE_RECONCILE_PROCESS_NAME,
      before: now() - AGGREGATE_RECONCILE_RETENTION_MS,
    });
  };
}
