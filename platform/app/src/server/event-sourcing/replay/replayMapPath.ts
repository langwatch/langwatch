import type { ClickHouseClient } from "@clickhouse/client";
import type IORedis from "ioredis";
import { isAtOrBeforeCutoff } from "./replayConstants";
import {
  discoverProjectionAggregates,
  filterDiscoveredByAggregateIds,
} from "./replayDiscovery";
import {
  pauseProjection,
  unpauseProjection,
  waitForActiveJobs,
} from "./replayDrain";
import type {
  CutoffInfo,
  DiscoveredAggregate,
  OccurredAtBounds,
  ReplayEvent,
} from "./replayEventLoader";
import {
  batchLoadAggregateEvents,
  getBoundedCutoffs,
  maxEventPosition,
} from "./replayEventLoader";
import { MapAccumulator } from "./replayExecutor";
import type { ReplayLogWriter } from "./replayLog";
import {
  aggregateKey,
  cleanupAll,
  clearFailedBatchMarkers,
  getCompletedSet,
  getCutoffMarkers,
  markCompletedBatch,
  markCutoffBatch,
  markPendingBatch,
  removeStaleMarker,
  unmarkBatch,
} from "./replayMarkers";
import type {
  BatchCompleteInfo,
  BatchPhase,
  RegisteredMapProjection,
  ReplayContext,
  ReplayProgress,
  ReplayResult,
} from "./types";

async function discoverAndScopeMapAggregates(params: {
  ctx: ReplayContext;
  projection: RegisteredMapProjection;
  tenantIds: string[];
  since: string;
  aggregateIds?: string[];
}): Promise<{
  allAggregates: DiscoveredAggregate[];
  byTenant: Map<string, DiscoveredAggregate[]>;
}> {
  const { ctx, projection, tenantIds, since, aggregateIds } = params;
  // Discover aggregates — reuses the same event_log scan as folds.
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

  return { allAggregates, byTenant };
}

async function removeStaleMapMarkers(params: {
  redis: IORedis;
  projectionName: string;
}): Promise<void> {
  const { redis, projectionName } = params;
  const staleMarkers = await getCutoffMarkers({ redis, projectionName });
  for (const aggKey of staleMarkers.keys()) {
    await removeStaleMarker({ redis, projectionName, aggKey });
  }
}

/** Running totals threaded (by mutation) through a map projection's replay. */
interface MapReplayAccumulator {
  aggregatesCompleted: number;
  totalEventsReplayed: number;
  skippedCount: number;
  batchErrors: number;
  firstError: string | undefined;
}

function partitionCompletedMapAggregates(params: {
  tenantAggregates: DiscoveredAggregate[];
  completedSet: Set<string>;
  acc: MapReplayAccumulator;
}): DiscoveredAggregate[] {
  const { tenantAggregates, completedSet, acc } = params;
  const remaining: DiscoveredAggregate[] = [];
  for (const agg of tenantAggregates) {
    if (completedSet.has(aggregateKey(agg))) {
      acc.skippedCount++;
      acc.aggregatesCompleted++;
    } else {
      remaining.push(agg);
    }
  }
  return remaining;
}

/**
 * Records a batch failure: clears its markers, unpauses the projection (best
 * effort), reports progress, and returns the early-return payload the caller
 * must return immediately — mirroring the original inline `return` on the
 * first batch error.
 */
async function recordMapBatchFailure(params: {
  redis: IORedis;
  projection: RegisteredMapProjection;
  batch: DiscoveredAggregate[];
  tenantId: string;
  batchNum: number;
  error: unknown;
  acc: MapReplayAccumulator;
  progress: ReplayProgress;
  emit: () => void;
  tenants: Array<[string, DiscoveredAggregate[]]>;
  log: ReplayLogWriter;
}): Promise<ReplayResult & { touchedTenants: string[] }> {
  const {
    redis,
    projection,
    batch,
    tenantId,
    batchNum,
    error,
    acc,
    progress,
    emit,
    tenants,
    log,
  } = params;

  acc.batchErrors++;
  const errorMsg = error instanceof Error ? error.message : String(error);
  if (!acc.firstError) acc.firstError = errorMsg;
  log.write({
    step: "error",
    tenant: tenantId,
    aggregate: `map-batch ${batchNum}`,
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

  progress.batchErrors = acc.batchErrors;
  progress.firstError = acc.firstError;
  emit();

  return {
    aggregatesReplayed: acc.aggregatesCompleted - acc.skippedCount,
    totalEvents: acc.totalEventsReplayed,
    batchErrors: acc.batchErrors,
    firstError: acc.firstError,
    touchedTenants: tenants.map(([tid]) => tid),
  };
}

function buildMapBatchProgress(params: {
  projection: RegisteredMapProjection;
  projectionIndex: number;
  totalProjections: number;
  allAggregatesCount: number;
  tenantCount: number;
  batchNum: number;
  totalBatches: number;
  batch: DiscoveredAggregate[];
  acc: MapReplayAccumulator;
  startTime: number;
}): ReplayProgress {
  const {
    projection,
    projectionIndex,
    totalProjections,
    allAggregatesCount,
    tenantCount,
    batchNum,
    totalBatches,
    batch,
    acc,
    startTime,
  } = params;
  return {
    phase: "replaying",
    currentProjectionName: projection.projectionName,
    currentProjectionKind: "map",
    currentProjectionIndex: projectionIndex,
    totalProjections,
    totalAggregates: allAggregatesCount,
    tenantCount,
    currentBatch: batchNum,
    totalBatches,
    batchAggregates: batch.length,
    batchPhase: "mark",
    batchEventsProcessed: 0,
    aggregatesCompleted: acc.aggregatesCompleted,
    totalEventsReplayed: acc.totalEventsReplayed,
    elapsedSec: (Date.now() - startTime) / 1000,
    skippedCount: acc.skippedCount,
    batchErrors: acc.batchErrors,
    firstError: acc.firstError,
  };
}

function recordMapBatchSuccess(params: {
  result: { eventsReplayed: number };
  acc: MapReplayAccumulator;
  batch: DiscoveredAggregate[];
  onBatchComplete?: (info: BatchCompleteInfo) => void;
  projection: RegisteredMapProjection;
  batchNum: number;
  totalBatches: number;
  batchStartTime: number;
}): void {
  const {
    result,
    acc,
    batch,
    onBatchComplete,
    projection,
    batchNum,
    totalBatches,
    batchStartTime,
  } = params;
  acc.totalEventsReplayed += result.eventsReplayed;
  acc.aggregatesCompleted += batch.length;

  onBatchComplete?.({
    projectionName: projection.projectionName,
    projectionKind: "map",
    batchNum,
    totalBatches,
    aggregatesInBatch: batch.length,
    eventsInBatch: result.eventsReplayed,
    durationSec: (Date.now() - batchStartTime) / 1000,
  });
}

interface ProcessMapBatchParams {
  ctx: ReplayContext;
  projection: RegisteredMapProjection;
  projectionIndex: number;
  totalProjections: number;
  batch: DiscoveredAggregate[];
  batchNum: number;
  totalBatches: number;
  tenantId: string;
  client: Awaited<ReturnType<ReplayContext["resolveClient"]>>;
  batchSize: number;
  allAggregatesCount: number;
  tenantCount: number;
  startTime: number;
  log: ReplayLogWriter;
  onProgress?: (progress: ReplayProgress) => void;
  onBatchComplete?: (info: BatchCompleteInfo) => void;
  acc: MapReplayAccumulator;
  tenants: Array<[string, DiscoveredAggregate[]]>;
}

/**
 * Runs one map batch's mark/pause/drain/cutoff/replay/write/unmark cycle and
 * its progress reporting, mutating `acc` in place. Returns the early-return
 * payload when the batch fails — the caller must stop processing further
 * batches/tenants and return it immediately, exactly mirroring the original
 * inline `return` on the first batch error.
 */
async function processMapBatch(
  params: ProcessMapBatchParams,
): Promise<(ReplayResult & { touchedTenants: string[] }) | null> {
  const { ctx, acc } = params;
  const redis = ctx.redis;
  const batchStartTime = Date.now();

  // `params` carries every field `buildMapBatchProgress` needs, by the same
  // names — passed straight through rather than re-listed.
  const progress = buildMapBatchProgress(params);

  const emit = () => {
    progress.elapsedSec = (Date.now() - params.startTime) / 1000;
    params.onProgress?.({ ...progress });
  };

  emit();

  try {
    const result = await replayMapBatch({
      ...params,
      redis,
      accumulatorOpts: ctx.accumulatorOpts,
      onBatchPhase: (phase, eventsProcessed) => {
        progress.batchPhase = phase;
        if (eventsProcessed !== undefined) {
          progress.batchEventsProcessed = eventsProcessed;
          progress.totalEventsReplayed =
            acc.totalEventsReplayed + eventsProcessed;
        }
        emit();
      },
    });

    recordMapBatchSuccess({ ...params, result, batchStartTime });
    return null;
  } catch (error) {
    return await recordMapBatchFailure({
      ...params,
      redis,
      error,
      progress,
      emit,
    });
  }
}

/**
 * Runs every tenant's batches in order, stopping and returning the
 * early-return payload the moment any batch fails — mirroring the original
 * nested-loop early `return`.
 */
async function runMapTenants(params: {
  ctx: ReplayContext;
  projection: RegisteredMapProjection;
  projectionIndex: number;
  totalProjections: number;
  aggregateBatchSize: number;
  batchSize: number;
  allAggregatesCount: number;
  tenantCount: number;
  startTime: number;
  log: ReplayLogWriter;
  onProgress?: (progress: ReplayProgress) => void;
  onBatchComplete?: (info: BatchCompleteInfo) => void;
  acc: MapReplayAccumulator;
  tenants: Array<[string, DiscoveredAggregate[]]>;
  completedSet: Set<string>;
}): Promise<(ReplayResult & { touchedTenants: string[] }) | null> {
  const { ctx, aggregateBatchSize, completedSet, acc, tenants } = params;

  for (const [tenantId, tenantAggregates] of tenants) {
    const client = await ctx.resolveClient(tenantId);
    const remaining = partitionCompletedMapAggregates({
      tenantAggregates,
      completedSet,
      acc,
    });

    const totalBatches = Math.ceil(remaining.length / aggregateBatchSize);

    for (let i = 0; i < remaining.length; i += aggregateBatchSize) {
      const batch = remaining.slice(i, i + aggregateBatchSize);
      const batchNum = Math.floor(i / aggregateBatchSize) + 1;

      const earlyReturn = await processMapBatch({
        ...params,
        batch,
        batchNum,
        totalBatches,
        tenantId,
        client,
      });
      if (earlyReturn) return earlyReturn;
    }
  }

  return null;
}

/**
 * Replays a single map projection across discovered aggregates.
 *
 * Mirrors `replayFoldProjection` but:
 * - No per-aggregate accumulator — each event is transformed and appended
 *   immediately (`projection.map(event) → store.append(record, ctx)`).
 * - "Replay" and "Write" phases collapse into the per-event loop.
 */
export async function replayMapProjection({
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
  projection: RegisteredMapProjection;
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

  const { allAggregates, byTenant } = await discoverAndScopeMapAggregates({
    ctx,
    projection,
    tenantIds,
    since,
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

  const completedSet = await getCompletedSet({
    redis,
    projectionName: projection.projectionName,
  });

  await removeStaleMapMarkers({
    redis,
    projectionName: projection.projectionName,
  });

  const acc: MapReplayAccumulator = {
    aggregatesCompleted: 0,
    totalEventsReplayed: 0,
    skippedCount: 0,
    batchErrors: 0,
    firstError: undefined,
  };

  const tenants = [...byTenant.entries()];

  const earlyReturn = await runMapTenants({
    ctx,
    projection,
    projectionIndex,
    totalProjections,
    aggregateBatchSize,
    batchSize,
    allAggregatesCount: allAggregates.length,
    tenantCount: byTenant.size,
    startTime,
    log,
    onProgress,
    onBatchComplete,
    acc,
    tenants,
    completedSet,
  });
  if (earlyReturn) return earlyReturn;

  await cleanupAll({ redis, projectionName: projection.projectionName });

  return {
    aggregatesReplayed: acc.aggregatesCompleted - acc.skippedCount,
    totalEvents: acc.totalEventsReplayed,
    batchErrors: acc.batchErrors,
    firstError: acc.firstError,
    touchedTenants: tenants.map(([tid]) => tid),
  };
}

/** Phases 1-3: MARK, PAUSE, DRAIN. */
async function markPauseAndDrainMapBatch(params: {
  redis: IORedis;
  projection: RegisteredMapProjection;
  batch: DiscoveredAggregate[];
  tenantId: string;
  log: ReplayLogWriter;
  onBatchPhase: (phase: BatchPhase, eventsProcessed?: number) => void;
}): Promise<void> {
  const { redis, projection, batch, tenantId, log, onBatchPhase } = params;
  const projectionName = projection.projectionName;
  const aggKeys = batch.map((agg) => aggregateKey(agg));

  // 1. MARK
  onBatchPhase("mark");
  await markPendingBatch({ redis, projectionName, aggKeys });
  log.write({
    step: "mark-batch",
    tenant: tenantId,
    count: batch.length,
    kind: "map",
  });

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
    kind: "map",
  });
  log.write({
    step: "drain-batch",
    tenant: tenantId,
    count: batch.length,
    durationMs: Date.now() - drainStart,
    kind: "map",
  });
}

/**
 * CUTOFF phase — occurred-at bounds first, for partition pruning (see the
 * fold path's `computeBatchCutoffs` for the full rationale). Aggregates
 * without a cutoff (no events) are unmarked immediately.
 */
async function computeMapBatchCutoffs(params: {
  client: ClickHouseClient;
  redis: IORedis;
  tenantId: string;
  batch: DiscoveredAggregate[];
  projection: RegisteredMapProjection;
  log: ReplayLogWriter;
}): Promise<{
  cutoffs: Map<string, CutoffInfo>;
  occurredAtBounds: OccurredAtBounds | undefined;
  withCutoffKeys: string[];
}> {
  const { client, redis, tenantId, batch, projection, log } = params;
  const projectionName = projection.projectionName;
  const aggKeys = batch.map((agg) => aggregateKey(agg));

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
    kind: "map",
  });

  if (withoutCutoffKeys.length > 0) {
    await unmarkBatch({ redis, projectionName, aggKeys: withoutCutoffKeys });
  }

  return { cutoffs, occurredAtBounds, withCutoffKeys };
}

async function applyMapEventIfWithinCutoff(params: {
  event: ReplayEvent;
  cutoffs: Map<string, CutoffInfo>;
  accumulator: MapAccumulator;
}): Promise<boolean> {
  const { event: e, cutoffs, accumulator } = params;
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
    await accumulator.apply(e);
    return true;
  }
  return false;
}

async function applyMapEventPage(params: {
  events: ReplayEvent[];
  cutoffs: Map<string, CutoffInfo>;
  accumulator: MapAccumulator;
}): Promise<number> {
  const { events, cutoffs, accumulator } = params;
  let applied = 0;
  for (const e of events) {
    const wasApplied = await applyMapEventIfWithinCutoff({
      event: e,
      cutoffs,
      accumulator,
    });
    if (wasApplied) applied++;
  }
  return applied;
}

/**
 * REPLAY phase — buffers through MapAccumulator so the WRITE phase can flush
 * via `store.bulkAppend` instead of awaiting one INSERT per event. For
 * ClickHouse-backed AppendStores this turns N round-trips into a small
 * number of chunked bulk inserts.
 */
async function streamMapReplayEvents(params: {
  client: ClickHouseClient;
  tenantId: string;
  projection: RegisteredMapProjection;
  batch: DiscoveredAggregate[];
  batchSize: number;
  cutoffs: Map<string, CutoffInfo>;
  occurredAtBounds: OccurredAtBounds | undefined;
  accumulator: MapAccumulator;
  onBatchPhase: (phase: BatchPhase, eventsProcessed?: number) => void;
}): Promise<number> {
  const {
    client,
    tenantId,
    projection,
    batch,
    batchSize,
    cutoffs,
    occurredAtBounds,
    accumulator,
    onBatchPhase,
  } = params;
  const maxCutoff = maxEventPosition(cutoffs.values());
  const aggregateIds = batch
    .filter((a) => cutoffs.has(aggregateKey(a)))
    .map((a) => a.aggregateId);

  let cursor: { timestamp: number; eventId: string } | undefined;
  let eventsProcessed = 0;

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

    eventsProcessed += await applyMapEventPage({
      events,
      cutoffs,
      accumulator,
    });

    // Emit progress once per loaded page, matching the fold path's cadence
    // — not once per event, which would hammer the progress callback.
    onBatchPhase("replay", eventsProcessed);

    const lastEvent = events[events.length - 1];
    if (lastEvent) {
      cursor = { timestamp: lastEvent.timestamp, eventId: lastEvent.id };
    }
    if (events.length < batchSize) break;
  }

  return eventsProcessed;
}

/**
 * Phases 6-7: WRITE the buffered records via bulkAppend (or sequential
 * append fallback, which carries each record's per-event context), then
 * COMPLETE + UNPAUSE — terminal `done:` markers preserve the cutoff boundary
 * so a job staged but never active during the pause doesn't re-run events
 * at/before the cutoff (double-write + double reactor dispatch) after
 * unpause. See the fold path for the full rationale.
 */
async function writeAndCompleteMapBatch(params: {
  redis: IORedis;
  projection: RegisteredMapProjection;
  tenantId: string;
  log: ReplayLogWriter;
  onBatchPhase: (phase: BatchPhase, eventsProcessed?: number) => void;
  accumulator: MapAccumulator;
  cutoffs: Map<string, CutoffInfo>;
  withCutoffKeys: string[];
  eventsProcessed: number;
}): Promise<void> {
  const {
    redis,
    projection,
    tenantId,
    log,
    onBatchPhase,
    accumulator,
    cutoffs,
    withCutoffKeys,
    eventsProcessed,
  } = params;
  const projectionName = projection.projectionName;

  onBatchPhase("write", eventsProcessed);
  await accumulator.flush();

  onBatchPhase("unmark", eventsProcessed);
  await markCompletedBatch({ redis, projectionName, cutoffs });
  await unpauseProjection({ redis, pauseKey: projection.pauseKey });
  log.write({
    step: "unmark-batch",
    tenant: tenantId,
    count: withCutoffKeys.length,
    kind: "map",
  });
}

/**
 * Replays a single batch of aggregates through a map projection.
 *
 * Same 7-phase cycle as the fold path's `replayBatch`, but the REPLAY phase
 * applies `projection.map(event)` and appends to `projection.store` per event,
 * without accumulating state. There's no WRITE step — appends happen inline.
 */
async function replayMapBatch({
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
  projection: RegisteredMapProjection;
  batch: DiscoveredAggregate[];
  tenantId: string;
  batchSize: number;
  accumulatorOpts: ReplayContext["accumulatorOpts"];
  log: ReplayLogWriter;
  onBatchPhase: (phase: BatchPhase, eventsProcessed?: number) => void;
}): Promise<{ eventsReplayed: number }> {
  await markPauseAndDrainMapBatch({
    redis,
    projection,
    batch,
    tenantId,
    log,
    onBatchPhase,
  });

  // 4. CUTOFF
  onBatchPhase("cutoff");
  const { cutoffs, occurredAtBounds, withCutoffKeys } =
    await computeMapBatchCutoffs({
      client,
      redis,
      tenantId,
      batch,
      projection,
      log,
    });

  if (withCutoffKeys.length === 0) {
    onBatchPhase("unmark");
    await unpauseProjection({ redis, pauseKey: projection.pauseKey });
    return { eventsReplayed: 0 };
  }

  await markCutoffBatch({
    redis,
    projectionName: projection.projectionName,
    cutoffs,
  });

  // 5. REPLAY
  onBatchPhase("replay", 0);
  const accumulator = new MapAccumulator(
    projection.definition,
    accumulatorOpts,
  );
  const replayStart = Date.now();
  const eventsProcessed = await streamMapReplayEvents({
    client,
    tenantId,
    projection,
    batch,
    batchSize,
    cutoffs,
    occurredAtBounds,
    accumulator,
    onBatchPhase,
  });

  log.write({
    step: "replay-batch",
    tenant: tenantId,
    count: withCutoffKeys.length,
    eventsProcessed,
    durationMs: Date.now() - replayStart,
    kind: "map",
  });

  // 6-7. WRITE, COMPLETE + UNPAUSE
  await writeAndCompleteMapBatch({
    redis,
    projection,
    tenantId,
    log,
    onBatchPhase,
    accumulator,
    cutoffs,
    withCutoffKeys,
    eventsProcessed,
  });

  return { eventsReplayed: eventsProcessed };
}
