import type { ClickHouseClient } from "@clickhouse/client";
import type IORedis from "ioredis";
import type {
  RegisteredFoldProjection,
  ReplayProgress,
  ReplayResult,
  BatchPhase,
  BatchCompleteInfo,
  ReplayContext,
} from "./types";
import { isAtOrBeforeCutoff } from "./replayConstants";
import type { DiscoveredAggregate } from "./replayEventLoader";
import {
  batchLoadAggregateEvents,
  getBoundedCutoffs,
  maxEventPosition,
} from "./replayEventLoader";
import {
  aggregateKey,
  markPendingBatch,
  markCutoffBatch,
  markCompletedBatch,
  unmarkBatch,
  clearFailedBatchMarkers,
  getCompletedSet,
  getCutoffMarkers,
  removeStaleMarker,
  cleanupAll,
} from "./replayMarkers";
import {
  pauseProjection,
  unpauseProjection,
  waitForActiveJobs,
} from "./replayDrain";
import { FoldAccumulator } from "./replayExecutor";
import type { ReplayLogWriter } from "./replayLog";
import {
  discoverProjectionAggregates,
  filterDiscoveredByAggregateIds,
} from "./replayDiscovery";

/**
 * Replays a single fold projection across discovered aggregates: discovery,
 * resume filtering against the completed set, then the per-batch 7-phase
 * mark/pause/drain/cutoff/replay/write/unmark cycle.
 */
export async function replayFoldProjection({
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
  projection: RegisteredFoldProjection;
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
  const redis = ctx.redis;
  const startTime = Date.now();

  // Discover aggregates — when tenantIds is empty, discover across ALL tenants
  let allAggregates: DiscoveredAggregate[] = [];
  const byTenant = new Map<string, DiscoveredAggregate[]>();

  const discoveryTargets = tenantIds.length > 0 ? tenantIds : [undefined];
  for (const tenantId of discoveryTargets) {
    const discovery = await discoverProjectionAggregates({
      resolveClient: ctx.resolveClient,
      eventTypes: projection.definition.eventTypes,
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

  if (allAggregates.length === 0) {
    return {
      aggregatesReplayed: 0,
      totalEvents: 0,
      batchErrors: 0,
      touchedTenants: [],
    };
  }

  if (dryRun) {
    return {
      aggregatesReplayed: 0,
      totalEvents: 0,
      batchErrors: 0,
      touchedTenants: [],
    };
  }

  // Get completed set for resume support
  const completedSet = await getCompletedSet({
    redis,
    projectionName: projection.projectionName,
  });

  // Remove stale markers
  const staleMarkers = await getCutoffMarkers({
    redis,
    projectionName: projection.projectionName,
  });
  for (const aggKey of staleMarkers.keys()) {
    await removeStaleMarker({
      redis,
      projectionName: projection.projectionName,
      aggKey,
    });
  }

  let aggregatesCompleted = 0;
  let totalEventsReplayed = 0;
  let skippedCount = 0;
  let batchErrors = 0;
  let firstError: string | undefined;

  const tenants = [...byTenant.entries()];

  for (const [tenantId, tenantAggregates] of tenants) {
    const client = await ctx.resolveClient(tenantId);
    const remaining: DiscoveredAggregate[] = [];
    for (const agg of tenantAggregates) {
      if (completedSet.has(aggregateKey(agg))) {
        skippedCount++;
        aggregatesCompleted++;
      } else {
        remaining.push(agg);
      }
    }

    const totalBatches = Math.ceil(remaining.length / aggregateBatchSize);

    for (let i = 0; i < remaining.length; i += aggregateBatchSize) {
      const batch = remaining.slice(i, i + aggregateBatchSize);
      const batchNum = Math.floor(i / aggregateBatchSize) + 1;
      const batchStartTime = Date.now();

      const progress: ReplayProgress = {
        phase: "replaying",
        currentProjectionName: projection.projectionName,
        currentProjectionKind: "fold",
        currentProjectionIndex: projectionIndex,
        totalProjections,
        totalAggregates: allAggregates.length,
        tenantCount: byTenant.size,
        currentBatch: batchNum,
        totalBatches,
        batchAggregates: batch.length,
        batchPhase: "mark",
        batchEventsProcessed: 0,
        aggregatesCompleted,
        totalEventsReplayed,
        elapsedSec: (Date.now() - startTime) / 1000,
        skippedCount,
        batchErrors,
        firstError,
      };

      const emit = () => {
        progress.elapsedSec = (Date.now() - startTime) / 1000;
        onProgress?.({ ...progress });
      };

      emit();

      try {
        const result = await replayBatch({
          client,
          redis,
          projection,
          batch,
          tenantId,
          batchSize,
          accumulatorOpts: ctx.accumulatorOpts,
          log,
          onBatchPhase: (phase, eventsProcessed) => {
            progress.batchPhase = phase;
            if (eventsProcessed !== undefined) {
              progress.batchEventsProcessed = eventsProcessed;
              progress.totalEventsReplayed =
                totalEventsReplayed + eventsProcessed;
            }
            emit();
          },
        });

        totalEventsReplayed += result.eventsReplayed;
        aggregatesCompleted += batch.length;

        onBatchComplete?.({
          projectionName: projection.projectionName,
          projectionKind: "fold",
          batchNum,
          totalBatches,
          aggregatesInBatch: batch.length,
          eventsInBatch: result.eventsReplayed,
          durationSec: (Date.now() - batchStartTime) / 1000,
        });
      } catch (error) {
        batchErrors++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (!firstError) firstError = errorMsg;
        log.write({
          step: "error",
          tenant: tenantId,
          aggregate: `batch ${batchNum}`,
          error: errorMsg,
        });

        await clearFailedBatchMarkers({
          redis,
          projectionNames: [projection.projectionName],
          aggKeys: batch.map((agg) => aggregateKey(agg)),
          log,
        });

        // Unpause BEFORE the emit below — cancellation can throw from
        // onProgress (ReplayCancelledError), and the pause key is a no-TTL
        // set member, so an emit-first order would leave live processing
        // frozen forever. Mirrors the optimized path's per-batch finally.
        await unpauseProjection({
          redis,
          pauseKey: projection.pauseKey,
        }).catch((unpauseError) => {
          // Log but don't rethrow: the original batch error must win, and the
          // emit below still has to run.
          log.write({
            step: "error",
            error: `unpause failed after batch error: ${
              unpauseError instanceof Error
                ? unpauseError.message
                : String(unpauseError)
            }`,
          });
        });

        progress.batchErrors = batchErrors;
        progress.firstError = firstError;
        emit();

        return {
          aggregatesReplayed: aggregatesCompleted - skippedCount,
          totalEvents: totalEventsReplayed,
          batchErrors,
          firstError,
          touchedTenants: tenants.map(([tid]) => tid),
        };
      }
    }
  }

  await cleanupAll({ redis, projectionName: projection.projectionName });

  return {
    aggregatesReplayed: aggregatesCompleted - skippedCount,
    totalEvents: totalEventsReplayed,
    batchErrors,
    firstError,
    touchedTenants: tenants.map(([tid]) => tid),
  };
}

/**
 * Replays a single batch of aggregates through the 7-phase cycle.
 *
 * Events are streamed page-by-page through a FoldAccumulator — only fold
 * states (bounded by batch.length) stay in memory, not the raw events.
 */
async function replayBatch({
  client,
  redis,
  projection,
  batch,
  tenantId,
  batchSize,
  accumulatorOpts,
  log,
  onBatchPhase,
}: {
  client: ClickHouseClient;
  redis: IORedis;
  projection: RegisteredFoldProjection;
  batch: DiscoveredAggregate[];
  tenantId: string;
  batchSize: number;
  accumulatorOpts: ReplayContext["accumulatorOpts"];
  log: ReplayLogWriter;
  onBatchPhase: (phase: BatchPhase, eventsProcessed?: number) => void;
}): Promise<{ eventsReplayed: number }> {
  const projectionName = projection.projectionName;
  const aggKeys = batch.map((agg) => aggregateKey(agg));

  // 1. MARK
  onBatchPhase("mark");
  await markPendingBatch({ redis, projectionName, aggKeys });
  log.write({ step: "mark-batch", tenant: tenantId, count: batch.length });

  // 2. PAUSE
  onBatchPhase("pause");
  await pauseProjection({ redis, pauseKey: projection.pauseKey });

  // 3. DRAIN
  onBatchPhase("drain");
  const drainStart = Date.now();
  await waitForActiveJobs({
    redis,
    aggregates: batch,
    projectionName,
    kind: "fold",
  });
  log.write({
    step: "drain-batch",
    tenant: tenantId,
    count: batch.length,
    durationMs: Date.now() - drainStart,
  });

  // 4. CUTOFF — occurred-at bounds first (over all events of the batch's
  //    aggregates) so the cutoff + load queries prune event_log's weekly
  //    partitions instead of scanning cold storage. See
  //    getAggregateOccurredAtBounds for why this bound is safe, and
  //    getBoundedCutoffs for the zero-event short-circuit.
  onBatchPhase("cutoff");
  const { cutoffs, occurredAtBounds } = await getBoundedCutoffs({
    client,
    tenantId,
    aggregateTypes: [...new Set(batch.map((a) => a.aggregateType))],
    aggregateIds: batch.map((a) => a.aggregateId),
    eventTypes: projection.definition.eventTypes,
  });

  const withCutoffKeys: string[] = [];
  const withoutCutoffKeys: string[] = [];
  for (const aggKey of aggKeys) {
    if (cutoffs.has(aggKey)) {
      withCutoffKeys.push(aggKey);
    } else {
      withoutCutoffKeys.push(aggKey);
    }
  }

  log.write({
    step: "cutoff-batch",
    tenant: tenantId,
    count: batch.length,
    withEvents: withCutoffKeys.length,
  });

  if (withoutCutoffKeys.length > 0) {
    await unmarkBatch({ redis, projectionName, aggKeys: withoutCutoffKeys });
  }

  if (withCutoffKeys.length === 0) {
    onBatchPhase("unmark");
    await unpauseProjection({ redis, pauseKey: projection.pauseKey });
    return { eventsReplayed: 0 };
  }

  await markCutoffBatch({ redis, projectionName, cutoffs });

  // 5. REPLAY — stream events page-by-page through the fold accumulator.
  //    Only fold states (bounded by batch size) stay in memory.
  onBatchPhase("replay", 0);
  const accumulator = new FoldAccumulator(
    projection.definition,
    accumulatorOpts,
  );
  const maxCutoff = maxEventPosition(cutoffs.values());
  const aggregateIds = batch
    .filter((a) => cutoffs.has(aggregateKey(a)))
    .map((a) => a.aggregateId);

  let cursor: { timestamp: number; eventId: string } | undefined;
  const replayStart = Date.now();

  while (true) {
    const events = await batchLoadAggregateEvents({
      client,
      tenantId,
      aggregateIds,
      eventTypes: projection.definition.eventTypes,
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
        isAtOrBeforeCutoff(e.timestamp, e.id, cutoff.timestamp, cutoff.eventId)
      ) {
        accumulator.apply(e);
        onBatchPhase("replay", accumulator.processed);
      }
    }

    const lastEvent = events[events.length - 1];
    if (lastEvent) {
      cursor = { timestamp: lastEvent.timestamp, eventId: lastEvent.id };
    }
    if (events.length < batchSize) break;
  }

  // 6. WRITE — flush accumulated fold states to ClickHouse
  const totalBatchEvents = accumulator.processed;
  onBatchPhase("write", totalBatchEvents);
  await accumulator.flush();

  log.write({
    step: "replay-batch",
    tenant: tenantId,
    count: withCutoffKeys.length,
    eventsProcessed: totalBatchEvents,
    durationMs: Date.now() - replayStart,
  });

  // 7. COMPLETE + UNPAUSE — replace each replayed aggregate's active cutoff
  //    marker with a terminal `done:` marker (rather than deleting it) so a
  //    job staged but never active during the pause is still skipped for
  //    events at/before the cutoff after unpause, instead of double-writing.
  onBatchPhase("unmark", totalBatchEvents);
  await markCompletedBatch({ redis, projectionName, cutoffs });
  await unpauseProjection({ redis, pauseKey: projection.pauseKey });
  log.write({
    step: "unmark-batch",
    tenant: tenantId,
    count: withCutoffKeys.length,
  });

  return { eventsReplayed: totalBatchEvents };
}
