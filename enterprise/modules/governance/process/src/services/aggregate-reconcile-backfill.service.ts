// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AggregateReconcilerService } from "./aggregate-reconciler.service.ts";

/** The cause every backfilled reconcile carries, so its outbox key repeats on a re-run. */
export const AGGREGATE_FULL_HISTORY_BACKFILL_CAUSE = "backfill:full-history";

/** Records one reconcile per aggregate in governance's outbox; a repeated key is one intent. */
export interface AggregateReconcileOutbox {
  enqueue(input: {
    organizationId: string;
    aggregateProjectIds: readonly string[];
    cause: string;
  }): Promise<void>;
}

/**
 * ADR-177 v4.10/v4.11: the one-off step that queues one reconcile per live aggregate, so every
 * existing aggregate widens to full history. `onAggregate` hears each one queued, for the
 * checkpoint. Spec: specs/governance/aggregate-project.feature
 */
export class AggregateReconcileBackfillService {
  static create(deps: {
    reconciler: Pick<AggregateReconcilerService, "liveAggregates">;
    /** Read at run: the outbox exists once the worker has built governance's pipeline. */
    outbox: () => AggregateReconcileOutbox | undefined;
  }): AggregateReconcileBackfillService {
    return new AggregateReconcileBackfillService(deps);
  }

  private constructor(
    private readonly deps: {
      reconciler: Pick<AggregateReconcilerService, "liveAggregates">;
      outbox: () => AggregateReconcileOutbox | undefined;
    },
  ) {}

  async enqueueAll({
    after,
    dryRun = false,
    signal,
    onAggregate,
  }: {
    after?: string | undefined;
    dryRun?: boolean;
    signal?: AbortSignal;
    onAggregate?: (progress: { afterAggregateProjectId: string }) => Promise<void>;
  }): Promise<{ afterAggregateProjectId: string | null; queued: number }> {
    const outbox = this.deps.outbox();
    if (!outbox && !dryRun) {
      throw new Error("The aggregate reconcile outbox is not built in this process");
    }
    const aggregates = (await this.deps.reconciler.liveAggregates()).filter(
      ({ id }) => after === undefined || id > after,
    );
    let cursor = after ?? null;
    let queued = 0;
    for (const { id, organizationId } of aggregates) {
      if (signal?.aborted) break;
      if (outbox && !dryRun) {
        await outbox.enqueue({
          organizationId,
          aggregateProjectIds: [id],
          cause: AGGREGATE_FULL_HISTORY_BACKFILL_CAUSE,
        });
        await onAggregate?.({ afterAggregateProjectId: id });
      }
      cursor = id;
      queued += 1;
    }
    return { afterAggregateProjectId: cursor, queued };
  }
}
