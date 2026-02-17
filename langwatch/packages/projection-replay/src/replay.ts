import type { ClickHouseClient } from "@clickhouse/client";
import type IORedis from "ioredis";
import type { DiscoveredFoldProjection } from "./discovery";
import {
  type DiscoveredAggregate,
  type ReplayEvent,
  countEventsForAggregates,
  discoverAffectedAggregates,
  batchGetCutoffEventIds,
  batchLoadAggregateEvents,
} from "./clickhouse";
import {
  aggregateKey,
  cleanupAll,
  getCutoffMarkers,
  markCutoffBatch,
  markPendingBatch,
  removeStaleMarker,
  unmarkBatch,
} from "./markers";
import { replayEvents } from "./replayExecutor";
import type { ReplayLog } from "./replayLog";

export type BatchPhase = "mark" | "drain" | "cutoff" | "load" | "replay" | "unmark";

export interface ReplayProgress {
  phase: "discovering" | "replaying" | "done" | "error";
  totalAggregates: number;
  tenantCount: number;

  /** Current batch number (1-based). */
  currentBatch: number;
  /** Total batches for current tenant. */
  totalBatches: number;
  /** Aggregates in current batch. */
  batchAggregates: number;
  /** Current step within the batch. */
  batchPhase: BatchPhase;

  /** Events replayed in current batch (during replay phase). */
  eventsReplayed: number;
  /** Total events to replay in current batch (known after load phase). */
  totalBatchEvents: number;

  /** Overall aggregates completed across all batches. */
  aggregatesCompleted: number;
  /** Overall events replayed across all batches. */
  totalEventsReplayed: number;
  /** Elapsed seconds since replay started. */
  elapsedSec: number;
  /** Aggregates skipped (completed in previous run). */
  skippedCount: number;

  errorMessage?: string;
}

type ProgressCallback = (progress: ReplayProgress) => void;

/**
 * Discovers aggregates affected by a projection since a given date.
 */
export async function discoverAggregates({
  client,
  projection,
  since,
  tenantId,
}: {
  client: ClickHouseClient;
  projection: DiscoveredFoldProjection;
  since: string;
  tenantId: string;
}): Promise<{
  aggregates: DiscoveredAggregate[];
  byTenant: Map<string, DiscoveredAggregate[]>;
  tenantCount: number;
  totalEvents: number;
}> {
  const sinceMs = new Date(since).getTime();
  const [aggregates, totalEvents] = await Promise.all([
    discoverAffectedAggregates({
      client,
      eventTypes: projection.definition.eventTypes,
      sinceMs,
      tenantId,
    }),
    countEventsForAggregates({
      client,
      eventTypes: projection.definition.eventTypes,
      sinceMs,
      tenantId,
    }),
  ]);

  const byTenant = new Map<string, DiscoveredAggregate[]>();
  for (const agg of aggregates) {
    const list = byTenant.get(agg.tenantId) ?? [];
    list.push(agg);
    byTenant.set(agg.tenantId, list);
  }

  return { aggregates, byTenant, tenantCount: byTenant.size, totalEvents };
}

/**
 * Main replay execution loop — processes aggregates in batches.
 */
export async function runReplay({
  client,
  redis,
  projection,
  aggregates,
  byTenant,
  batchSize,
  aggregateBatchSize,
  log,
  onProgress,
  completedSet,
}: {
  client: ClickHouseClient;
  redis: IORedis;
  projection: DiscoveredFoldProjection;
  aggregates: DiscoveredAggregate[];
  byTenant: Map<string, DiscoveredAggregate[]>;
  batchSize: number;
  aggregateBatchSize: number;
  log: ReplayLog;
  onProgress: ProgressCallback;
  completedSet: Set<string>;
}): Promise<{ aggregatesReplayed: number; totalEvents: number }> {
  const startTime = Date.now();
  let aggregatesCompleted = 0;
  let totalEventsReplayed = 0;
  let skippedCount = 0;

  // Remove stale markers (crashed mid-replay)
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

  const tenants = [...byTenant.entries()];

  for (const [tenantId, tenantAggregates] of tenants) {
    // Separate completed from remaining
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

      const progress: ReplayProgress = {
        phase: "replaying",
        totalAggregates: aggregates.length,
        tenantCount: byTenant.size,
        currentBatch: batchNum,
        totalBatches,
        batchAggregates: batch.length,
        batchPhase: "mark",
        eventsReplayed: 0,
        totalBatchEvents: 0,
        aggregatesCompleted,
        totalEventsReplayed,
        elapsedSec: (Date.now() - startTime) / 1000,
        skippedCount,
      };

      const emit = () => {
        progress.elapsedSec = (Date.now() - startTime) / 1000;
        onProgress({ ...progress });
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
          log,
          onBatchProgress: (bp) => {
            progress.batchPhase = bp.batchPhase;
            progress.eventsReplayed = bp.eventsReplayed;
            progress.totalBatchEvents = bp.totalBatchEvents;
            progress.totalEventsReplayed = totalEventsReplayed + bp.eventsReplayed;
            emit();
          },
        });

        totalEventsReplayed += result.eventsReplayed;
        aggregatesCompleted += batch.length;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log.write({
          step: "error",
          tenant: tenantId,
          aggregate: `batch ${batchNum}`,
          error: errorMsg,
        });
        aggregatesCompleted += batch.length;
      }
    }
  }

  await cleanupAll({ redis, projectionName: projection.projectionName });

  return {
    aggregatesReplayed: aggregatesCompleted - skippedCount,
    totalEvents: totalEventsReplayed,
  };
}

interface BatchProgressUpdate {
  batchPhase: BatchPhase;
  eventsReplayed: number;
  totalBatchEvents: number;
}

/**
 * Process a batch: mark → drain → cutoff → load → replay → unmark.
 *
 * Load phase fetches all events into memory (fast CH query).
 * Replay phase processes them one by one with store calls (slow, per-event progress).
 */
async function replayBatch({
  client,
  redis,
  projection,
  batch,
  tenantId,
  batchSize,
  log,
  onBatchProgress,
}: {
  client: ClickHouseClient;
  redis: IORedis;
  projection: DiscoveredFoldProjection;
  batch: DiscoveredAggregate[];
  tenantId: string;
  batchSize: number;
  log: ReplayLog;
  onBatchProgress: (p: BatchProgressUpdate) => void;
}): Promise<{ eventsReplayed: number }> {
  const projectionName = projection.projectionName;
  const aggKeys = batch.map((agg) => aggregateKey(agg));

  const emitPhase = (batchPhase: BatchPhase, extra?: Partial<BatchProgressUpdate>) => {
    onBatchProgress({
      batchPhase,
      eventsReplayed: 0,
      totalBatchEvents: 0,
      ...extra,
    });
  };

  // 1. MARK
  emitPhase("mark");
  await markPendingBatch({ redis, projectionName, aggKeys });
  log.write({ step: "mark-batch", tenant: tenantId, count: batch.length });

  // 2. DRAIN
  emitPhase("drain");
  const drainStart = Date.now();
  await drainGroupQueueBatch({
    redis,
    queueName: projection.queueName,
    aggregates: batch,
  });
  log.write({
    step: "drain-batch",
    tenant: tenantId,
    count: batch.length,
    durationMs: Date.now() - drainStart,
  });

  // 3. CUTOFF
  emitPhase("cutoff");
  const cutoffs = await batchGetCutoffEventIds({
    client,
    tenantId,
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
    emitPhase("unmark");
    return { eventsReplayed: 0 };
  }

  await markCutoffBatch({ redis, projectionName, cutoffs });

  // 4. LOAD — fetch all events into memory (fast)
  emitPhase("load");
  const maxCutoff = [...cutoffs.values()].reduce((a, b) => (a > b ? a : b));
  const aggregateIds = batch
    .filter((a) => cutoffs.has(aggregateKey(a)))
    .map((a) => a.aggregateId);

  const allEvents: ReplayEvent[] = [];
  let cursorEventId = "";

  while (true) {
    const events = await batchLoadAggregateEvents({
      client,
      tenantId,
      aggregateIds,
      eventTypes: projection.definition.eventTypes,
      maxCutoffEventId: maxCutoff,
      cursorEventId,
      batchSize,
    });

    if (events.length === 0) break;

    // Filter per-aggregate cutoff in JS
    for (const e of events) {
      const key = aggregateKey({
        tenantId: e.tenantId,
        aggregateType: e.aggregateType,
        aggregateId: e.aggregateId,
      });
      const cutoff = cutoffs.get(key);
      if (cutoff != null && e.id <= cutoff) {
        allEvents.push(e);
      }
    }

    const lastEvent = events[events.length - 1];
    if (lastEvent) cursorEventId = lastEvent.id;
    if (events.length < batchSize) break;
  }

  // 5. REPLAY — coalesce all events into shared state per projection key,
  //    then store once per unique key (no per-aggregate grouping or mutex needed).
  const totalBatchEvents = allEvents.length;
  let eventsReplayed = 0;

  onBatchProgress({ batchPhase: "replay", eventsReplayed: 0, totalBatchEvents });

  const replayStart = Date.now();

  await replayEvents({
    projection: projection.definition,
    events: allEvents,
    tenantId,
    keyStates: new Map(),
    onEvent: () => {
      eventsReplayed++;
      onBatchProgress({ batchPhase: "replay", eventsReplayed, totalBatchEvents });
    },
  });

  log.write({
    step: "replay-batch",
    tenant: tenantId,
    count: withCutoffKeys.length,
    eventsProcessed: totalBatchEvents,
    durationMs: Date.now() - replayStart,
  });

  // 6. UNMARK
  emitPhase("unmark", { eventsReplayed: totalBatchEvents, totalBatchEvents });
  await unmarkBatch({ redis, projectionName, aggKeys: withCutoffKeys });
  log.write({ step: "unmark-batch", tenant: tenantId, count: withCutoffKeys.length });

  return { eventsReplayed: totalBatchEvents };
}

function deriveGroupId(agg: DiscoveredAggregate): string {
  return `${agg.tenantId}:${agg.aggregateType}:${agg.aggregateId}`;
}

async function drainGroupQueueBatch({
  redis,
  queueName,
  aggregates,
}: {
  redis: IORedis;
  queueName: string;
  aggregates: DiscoveredAggregate[];
}): Promise<void> {
  if (aggregates.length === 0) return;

  const maxWaitMs = 60_000;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const pipeline = redis.pipeline();
    for (const agg of aggregates) {
      const groupId = deriveGroupId(agg);
      pipeline.zcard(`${queueName}:gq:group:${groupId}:jobs`);
      pipeline.get(`${queueName}:gq:group:${groupId}:active`);
    }
    const results = await pipeline.exec();
    if (!results) break;

    let allDrained = true;
    for (let i = 0; i < aggregates.length; i++) {
      const pending = results[i * 2]?.[1] as number;
      const active = results[i * 2 + 1]?.[1] as string | null;
      if (pending > 0 || active !== null) {
        allDrained = false;
        break;
      }
    }

    if (allDrained) return;
    await sleep(500);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
