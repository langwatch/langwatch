import { nowInstant } from "@langwatch/time";

import { isAtOrBeforeCutoff } from "./replayConstants.ts";
import { discoverProjectionAggregates, filterDiscoveredByAggregateIds } from "./replayDiscovery.ts";
import { pauseProjection, unpauseProjection, waitForActiveJobs } from "./replayDrain.ts";
import {
  type DiscoveredAggregate,
  type ReplayEventSource,
  maxEventPosition,
} from "./replayEventSource.ts";
import { type ReplayAccumulator, StateAccumulator } from "./replayExecutor.ts";
import type { ReplayLogWriter } from "./replayLog.ts";
import { aggregateKey } from "./replayMarkers.ts";
import type {
  BatchCompleteInfo,
  RegisteredStateProjection,
  ReplayContext,
  ReplayProgress,
  ReplayResult,
} from "./types.ts";

/**
 * Replays one tenant's aggregates through a shared accumulator, batch by
 * batch, and flushes once at the end — the per-tenant body of
 * `replayStateProjection`, extracted so the caller's loop stays flat.
 */
async function replayTenantForState({
  ctx,
  projection,
  projectionIndex,
  totalProjections,
  tenantId,
  tenantAggregates,
  allAggregates,
  byTenant,
  aggregateBatchSize,
  batchSize,
  startTime,
  aggregatesCompletedSoFar,
  totalEventsReplayedSoFar,
  batchErrorsSoFar,
  firstErrorSoFar,
  log,
  onProgress,
  onBatchComplete,
}: {
  ctx: ReplayContext;
  projection: RegisteredStateProjection;
  projectionIndex: number;
  totalProjections: number;
  tenantId: string;
  tenantAggregates: DiscoveredAggregate[];
  allAggregates: DiscoveredAggregate[];
  byTenant: Map<string, DiscoveredAggregate[]>;
  aggregateBatchSize: number;
  batchSize: number;
  startTime: number;
  aggregatesCompletedSoFar: number;
  totalEventsReplayedSoFar: number;
  batchErrorsSoFar: number;
  firstErrorSoFar: string | undefined;
  log: ReplayLogWriter;
  onProgress?: (progress: ReplayProgress) => void;
  onBatchComplete?: (info: BatchCompleteInfo) => void;
}): Promise<
  | { ok: true; aggregatesCompleted: number; totalEventsReplayed: number }
  | { ok: false; errorMsg: string }
> {
  // One accumulator per tenant: a projection key may group several aggregates,
  // so we fold the whole tenant before writing one row per key.
  const accumulator = projection.open<ReplayAccumulator>(
    (definition) => new StateAccumulator(definition, ctx.accumulatorOpts),
  );
  const totalBatches = Math.ceil(tenantAggregates.length / aggregateBatchSize);
  let aggregatesCompleted = aggregatesCompletedSoFar;
  let totalEventsReplayed = totalEventsReplayedSoFar;

  try {
    for (let i = 0; i < tenantAggregates.length; i += aggregateBatchSize) {
      const batch = tenantAggregates.slice(i, i + aggregateBatchSize);
      const batchNum = Math.floor(i / aggregateBatchSize) + 1;
      const batchStartTime = nowInstant().epochMilliseconds;

      const emitBatchProgress = (
        batchPhase: ReplayProgress["batchPhase"],
        batchEventsProcessed: number,
      ) => {
        onProgress?.({
          phase: "replaying",
          currentProjectionName: projection.projectionName,
          currentProjectionKind: "state",
          currentProjectionIndex: projectionIndex,
          totalProjections,
          totalAggregates: allAggregates.length,
          tenantCount: byTenant.size,
          currentBatch: batchNum,
          totalBatches,
          batchAggregates: batch.length,
          batchPhase,
          batchEventsProcessed,
          aggregatesCompleted,
          totalEventsReplayed,
          elapsedSec: (nowInstant().epochMilliseconds - startTime) / 1000,
          skippedCount: 0,
          batchErrors: batchErrorsSoFar,
          firstError: firstErrorSoFar,
        });
      };

      const eventsInBatch = await replayStateBatch({
        eventSource: ctx.eventSource,
        projection,
        batch,
        tenantId,
        batchSize,
        accumulator,
        onProgress: (processed) => emitBatchProgress("replay", processed),
      });

      totalEventsReplayed += eventsInBatch;
      aggregatesCompleted += batch.length;

      onBatchComplete?.({
        projectionName: projection.projectionName,
        projectionKind: "state",
        batchNum,
        totalBatches,
        aggregatesInBatch: batch.length,
        eventsInBatch,
        durationSec: (nowInstant().epochMilliseconds - batchStartTime) / 1000,
      });
    }

    // WRITE — one StoredProjection per key for this tenant, from init().
    await accumulator.flush();
    log.write({
      step: "replay-state-tenant",
      tenant: tenantId,
      count: tenantAggregates.length,
    });
    return { ok: true, aggregatesCompleted, totalEventsReplayed };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.write({
      step: "error",
      tenant: tenantId,
      aggregate: projection.projectionName,
      error: errorMsg,
    });
    return { ok: false, errorMsg };
  }
}

/** Replay Postgres operational state projection from init() in a single pause/drain phase. */
export async function replayStateProjection({
  ctx,
  projection,
  projectionIndex,
  totalProjections,
  tenantIds,
  aggregateIds,
  since,
  batchSize,
  aggregateBatchSize,
  dryRun,
  log,
  onProgress,
  onBatchComplete,
}: {
  ctx: ReplayContext;
  projection: RegisteredStateProjection;
  projectionIndex: number;
  totalProjections: number;
  tenantIds: string[];
  aggregateIds?: string[];
  since: string;
  batchSize: number;
  aggregateBatchSize: number;
  dryRun: boolean;
  log: ReplayLogWriter;
  onProgress?: (progress: ReplayProgress) => void;
  onBatchComplete?: (info: BatchCompleteInfo) => void;
}): Promise<ReplayResult & { touchedTenants: string[] }> {
  const startTime = nowInstant().epochMilliseconds;
  const eventTypes = projection.definition.eventTypes;

  // Discover aggregates — when tenantIds is empty, discover across ALL tenants.
  let allAggregates: DiscoveredAggregate[] = [];
  const byTenant = new Map<string, DiscoveredAggregate[]>();

  const discoveryTargets = tenantIds.length > 0 ? tenantIds : [undefined];
  for (const tenantId of discoveryTargets) {
    const discovery = await discoverProjectionAggregates({
      eventSource: ctx.eventSource,
      eventTypes,
      since,
      tenantId,
    });
    allAggregates = allAggregates.concat(discovery.aggregates);
    for (const [tid, aggs] of discovery.byTenant) {
      const existing = byTenant.get(tid) ?? [];
      byTenant.set(tid, existing.concat(aggs));
    }
  }

  // Scoped replay: keep only the requested aggregates (no-op for full replay).
  allAggregates = filterDiscoveredByAggregateIds({
    allAggregates,
    byTenant,
    aggregateIds,
  });

  if (allAggregates.length === 0 || dryRun) {
    return {
      aggregatesReplayed: 0,
      totalEvents: 0,
      batchErrors: 0,
      touchedTenants: [],
    };
  }

  await pauseProjection({ redis: ctx.redis, pauseKey: projection.pauseKey });
  try {
    await waitForActiveJobs({
      redis: ctx.redis,
      aggregates: allAggregates,
      projectionName: projection.projectionName,
      kind: "state",
    });
  } catch (error) {
    await unpauseProjection({
      redis: ctx.redis,
      pauseKey: projection.pauseKey,
    }).catch(() => undefined);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      aggregatesReplayed: 0,
      totalEvents: 0,
      batchErrors: 1,
      firstError: errorMsg,
      touchedTenants: [],
    };
  }

  let aggregatesCompleted = 0;
  let totalEventsReplayed = 0;
  let batchErrors = 0;
  let firstError: string | undefined;

  const tenants = [...byTenant.entries()];

  for (const [tenantId, tenantAggregates] of tenants) {
    const result = await replayTenantForState({
      ctx,
      projection,
      projectionIndex,
      totalProjections,
      tenantId,
      tenantAggregates,
      allAggregates,
      byTenant,
      aggregateBatchSize,
      batchSize,
      startTime,
      aggregatesCompletedSoFar: aggregatesCompleted,
      totalEventsReplayedSoFar: totalEventsReplayed,
      batchErrorsSoFar: batchErrors,
      firstErrorSoFar: firstError,
      log,
      onProgress,
      onBatchComplete,
    });

    if (!result.ok) {
      batchErrors++;
      if (!firstError) firstError = result.errorMsg;
      await unpauseProjection({
        redis: ctx.redis,
        pauseKey: projection.pauseKey,
      }).catch(() => undefined);
      return {
        aggregatesReplayed: aggregatesCompleted,
        totalEvents: totalEventsReplayed,
        batchErrors,
        firstError,
        touchedTenants: tenants.map(([tid]) => tid),
      };
    }

    aggregatesCompleted = result.aggregatesCompleted;
    totalEventsReplayed = result.totalEventsReplayed;
  }

  await unpauseProjection({
    redis: ctx.redis,
    pauseKey: projection.pauseKey,
  });

  return {
    aggregatesReplayed: aggregatesCompleted,
    totalEvents: totalEventsReplayed,
    batchErrors,
    firstError,
    touchedTenants: tenants.map(([tid]) => tid),
  };
}

/**
 * Streams one batch of a tenant's aggregates through the shared accumulator,
 * bounded by each aggregate's cutoff so the read is a stable point-in-time
 * snapshot (and prunes event_log's weekly partitions via occurred-at bounds).
 */
async function replayStateBatch({
  eventSource,
  projection,
  batch,
  tenantId,
  batchSize,
  accumulator,
  onProgress,
}: {
  eventSource: ReplayEventSource;
  projection: RegisteredStateProjection;
  batch: DiscoveredAggregate[];
  tenantId: string;
  batchSize: number;
  accumulator: ReplayAccumulator;
  onProgress: (eventsProcessed: number) => void;
}): Promise<number> {
  const eventTypes = projection.definition.eventTypes;

  const { cutoffs, occurredAtBounds } = await eventSource.getBoundedCutoffs({
    tenantId,
    aggregateTypes: [...new Set(batch.map((a) => a.aggregateType))],
    aggregateIds: batch.map((a) => a.aggregateId),
    eventTypes,
  });

  if (cutoffs.size === 0) return 0;

  const maxCutoff = maxEventPosition(cutoffs.values());
  const aggregateIds = batch.filter((a) => cutoffs.has(aggregateKey(a))).map((a) => a.aggregateId);

  let cursor: { timestamp: number; eventId: string } | undefined;
  let eventsApplied = 0;

  for (;;) {
    const events = await eventSource.loadAggregateEvents({
      tenantId,
      aggregateIds,
      eventTypes,
      maxCutoff,
      cursor,
      batchSize,
      occurredAtBounds,
    });

    if (events.length === 0) break;

    for (const e of events) {
      const key = aggregateKey({
        tenantId: e.tenantId,
        aggregateType: e.aggregateType,
        aggregateId: e.aggregateId,
      });
      const cutoff = cutoffs.get(key);
      if (
        cutoff != null &&
        isAtOrBeforeCutoff({
          eventTimestamp: e.timestamp,
          eventId: e.id,
          cutoffTimestamp: cutoff.timestamp,
          cutoffEventId: cutoff.eventId,
        })
      ) {
        accumulator.apply(e);
        eventsApplied++;
        onProgress(eventsApplied);
      }
    }

    const lastEvent = events[events.length - 1];
    if (lastEvent) {
      cursor = { timestamp: lastEvent.timestamp, eventId: lastEvent.id };
    }
    if (events.length < batchSize) break;
  }

  return eventsApplied;
}
