import type { ClickHouseClient } from "@clickhouse/client";
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
  ReplayEvent,
} from "./replayEventLoader";
import {
  batchLoadAggregateEvents,
  getBoundedCutoffs,
  maxEventPosition,
} from "./replayEventLoader";
import { StateAccumulator } from "./replayExecutor";
import type { ReplayLogWriter } from "./replayLog";
import { aggregateKey } from "./replayMarkers";
import type {
  BatchCompleteInfo,
  RegisteredStateProjection,
  ReplayContext,
  ReplayProgress,
  ReplayResult,
} from "./types";

async function discoverAndScopeStateAggregates(params: {
  ctx: ReplayContext;
  eventTypes: readonly string[];
  tenantIds: string[];
  since: string;
  aggregateIds?: string[];
}): Promise<{
  allAggregates: DiscoveredAggregate[];
  byTenant: Map<string, DiscoveredAggregate[]>;
}> {
  const { ctx, eventTypes, tenantIds, since, aggregateIds } = params;
  // Discover aggregates — when tenantIds is empty, discover across ALL tenants.
  let allAggregates: DiscoveredAggregate[] = [];
  const byTenant = new Map<string, DiscoveredAggregate[]>();

  const discoveryTargets = tenantIds.length > 0 ? tenantIds : [undefined];
  for (const tenantId of discoveryTargets) {
    const discovery = await discoverProjectionAggregates({
      resolveClient: ctx.resolveClient,
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

  return { allAggregates, byTenant };
}

/**
 * Pauses the projection then drains its in-flight jobs. On a drain failure,
 * unpauses (best effort) and returns the early-return payload the caller
 * must return immediately; returns null on success.
 */
async function pauseAndDrainForStateReplay(params: {
  ctx: ReplayContext;
  projection: RegisteredStateProjection;
  allAggregates: DiscoveredAggregate[];
}): Promise<(ReplayResult & { touchedTenants: string[] }) | null> {
  const { ctx, projection, allAggregates } = params;
  await pauseProjection({ redis: ctx.redis, pauseKey: projection.pauseKey });
  try {
    await waitForActiveJobs({
      redis: ctx.redis,
      aggregates: allAggregates,
      projectionName: projection.projectionName,
      kind: "state",
    });
    return null;
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
}

/** Running totals threaded (by mutation) through a state projection's replay. */
interface StateReplayAccumulator {
  aggregatesCompleted: number;
  totalEventsReplayed: number;
  batchErrors: number;
  firstError: string | undefined;
}

function buildStateBatchProgress(params: {
  projection: RegisteredStateProjection;
  projectionIndex: number;
  totalProjections: number;
  allAggregatesCount: number;
  tenantCount: number;
  batchNum: number;
  totalBatches: number;
  batch: DiscoveredAggregate[];
  batchPhase: ReplayProgress["batchPhase"];
  batchEventsProcessed: number;
  acc: StateReplayAccumulator;
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
    batchPhase,
    batchEventsProcessed,
    acc,
    startTime,
  } = params;
  return {
    phase: "replaying",
    currentProjectionName: projection.projectionName,
    currentProjectionKind: "state",
    currentProjectionIndex: projectionIndex,
    totalProjections,
    totalAggregates: allAggregatesCount,
    tenantCount,
    currentBatch: batchNum,
    totalBatches,
    batchAggregates: batch.length,
    batchPhase,
    batchEventsProcessed,
    aggregatesCompleted: acc.aggregatesCompleted,
    totalEventsReplayed: acc.totalEventsReplayed,
    elapsedSec: (Date.now() - startTime) / 1000,
    skippedCount: 0,
    batchErrors: acc.batchErrors,
    firstError: acc.firstError,
  };
}

interface ProcessStateTenantParams {
  ctx: ReplayContext;
  projection: RegisteredStateProjection;
  projectionIndex: number;
  totalProjections: number;
  tenantId: string;
  tenantAggregates: DiscoveredAggregate[];
  aggregateBatchSize: number;
  batchSize: number;
  allAggregatesCount: number;
  tenantCount: number;
  startTime: number;
  log: ReplayLogWriter;
  onProgress?: (progress: ReplayProgress) => void;
  onBatchComplete?: (info: BatchCompleteInfo) => void;
  acc: StateReplayAccumulator;
  tenants: Array<[string, DiscoveredAggregate[]]>;
}

/** The per-tenant batch loop: streams every batch through the shared accumulator. */
async function runStateTenantBatches(
  params: ProcessStateTenantParams & {
    accumulator: StateAccumulator;
    client: ClickHouseClient;
  },
): Promise<void> {
  const {
    projection,
    projectionIndex,
    totalProjections,
    tenantId,
    tenantAggregates,
    aggregateBatchSize,
    batchSize,
    allAggregatesCount,
    tenantCount,
    startTime,
    onProgress,
    onBatchComplete,
    acc,
    accumulator,
    client,
  } = params;
  const totalBatches = Math.ceil(tenantAggregates.length / aggregateBatchSize);

  for (let i = 0; i < tenantAggregates.length; i += aggregateBatchSize) {
    const batch = tenantAggregates.slice(i, i + aggregateBatchSize);
    const batchNum = Math.floor(i / aggregateBatchSize) + 1;
    const batchStartTime = Date.now();

    const emit = (
      batchPhase: ReplayProgress["batchPhase"],
      batchEventsProcessed: number,
    ) => {
      onProgress?.(
        buildStateBatchProgress({
          projection,
          projectionIndex,
          totalProjections,
          allAggregatesCount,
          tenantCount,
          batchNum,
          totalBatches,
          batch,
          batchPhase,
          batchEventsProcessed,
          acc,
          startTime,
        }),
      );
    };

    const eventsInBatch = await replayStateBatch({
      client,
      projection,
      batch,
      tenantId,
      batchSize,
      accumulator,
      onProgress: (processed) => emit("replay", processed),
    });

    acc.totalEventsReplayed += eventsInBatch;
    acc.aggregatesCompleted += batch.length;

    onBatchComplete?.({
      projectionName: projection.projectionName,
      projectionKind: "state",
      batchNum,
      totalBatches,
      aggregatesInBatch: batch.length,
      eventsInBatch,
      durationSec: (Date.now() - batchStartTime) / 1000,
    });
  }
}

/**
 * Replays one tenant's aggregates through a fresh (per-tenant) accumulator
 * and flushes it once at the end — a projection key may span aggregates, so
 * a key is only complete after every one of the tenant's aggregates has been
 * folded. On failure, unpauses the projection (best effort) and returns the
 * early-return payload the caller must return immediately; returns null on
 * success.
 */
async function processStateTenant(
  params: ProcessStateTenantParams,
): Promise<(ReplayResult & { touchedTenants: string[] }) | null> {
  const { ctx, projection, tenantId, tenantAggregates, log, acc, tenants } =
    params;

  // One accumulator per tenant: a projection key may group several aggregates,
  // so we fold the whole tenant before writing one row per key.
  const accumulator = new StateAccumulator(
    projection.definition,
    ctx.accumulatorOpts,
  );

  try {
    const client = await ctx.resolveClient(tenantId);
    await runStateTenantBatches({ ...params, accumulator, client });

    // WRITE — one StoredProjection per key for this tenant, from init().
    await accumulator.flush();
    log.write({
      step: "replay-state-tenant",
      tenant: tenantId,
      count: tenantAggregates.length,
    });
    return null;
  } catch (error) {
    acc.batchErrors++;
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (!acc.firstError) acc.firstError = errorMsg;
    log.write({
      step: "error",
      tenant: tenantId,
      aggregate: projection.projectionName,
      error: errorMsg,
    });
    await unpauseProjection({
      redis: ctx.redis,
      pauseKey: projection.pauseKey,
    }).catch(() => undefined);
    return {
      aggregatesReplayed: acc.aggregatesCompleted,
      totalEvents: acc.totalEventsReplayed,
      batchErrors: acc.batchErrors,
      firstError: acc.firstError,
      touchedTenants: tenants.map(([tid]) => tid),
    };
  }
}

/**
 * Replays a single `.withProjection()` operational state projection into its
 * `StateProjectionStore`.
 *
 * A state rebuild differs from the fold/map paths in two deliberate ways:
 *
 * - **One projection-wide pause/drain.** State is rebuilt from `init()` while
 *   its live queue is paused, then queued events resume against the rebuilt
 *   cursor. Per-batch marker/swap machinery is unnecessary because Postgres
 *   rows are deterministic upserts rather than ClickHouse table replacements.
 * - **One accumulator per tenant, flushed once at the tenant's end.** A
 *   projection key may span aggregates (`projection.key`), so a key is only
 *   complete after every one of the tenant's aggregates has been folded. State
 *   memory is bounded by the tenant's projection-key cardinality, not events.
 *
 * Reads canonical events from ClickHouse only. It never touches subscribers,
 * reactors, process managers, or the outbox — there is no seam here that could.
 */
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
  const startTime = Date.now();
  const eventTypes = projection.definition.eventTypes;

  const { allAggregates, byTenant } = await discoverAndScopeStateAggregates({
    ctx,
    eventTypes,
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

  const drainFailure = await pauseAndDrainForStateReplay({
    ctx,
    projection,
    allAggregates,
  });
  if (drainFailure) return drainFailure;

  const acc: StateReplayAccumulator = {
    aggregatesCompleted: 0,
    totalEventsReplayed: 0,
    batchErrors: 0,
    firstError: undefined,
  };

  const tenants = [...byTenant.entries()];

  for (const [tenantId, tenantAggregates] of tenants) {
    const earlyReturn = await processStateTenant({
      ctx,
      projection,
      projectionIndex,
      totalProjections,
      tenantId,
      tenantAggregates,
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
    });
    if (earlyReturn) return earlyReturn;
  }

  await unpauseProjection({
    redis: ctx.redis,
    pauseKey: projection.pauseKey,
  });

  return {
    aggregatesReplayed: acc.aggregatesCompleted,
    totalEvents: acc.totalEventsReplayed,
    batchErrors: acc.batchErrors,
    firstError: acc.firstError,
    touchedTenants: tenants.map(([tid]) => tid),
  };
}

/**
 * Applies one event if it falls at/before its aggregate's cutoff, reporting
 * the running total immediately (state's per-event progress cadence, unlike
 * the fold/map paths' per-page emit).
 */
function applyStateEventIfWithinCutoff(params: {
  event: ReplayEvent;
  cutoffs: Map<string, CutoffInfo>;
  accumulator: StateAccumulator;
  eventsApplied: number;
  onProgress: (eventsProcessed: number) => void;
}): number {
  const { event: e, cutoffs, accumulator, eventsApplied, onProgress } = params;
  const key = aggregateKey({
    tenantId: e.tenantId,
    aggregateType: e.aggregateType,
    aggregateId: e.aggregateId,
  });
  const cutoff = cutoffs.get(key);
  if (
    cutoff == null ||
    !isAtOrBeforeCutoff({
      eventTimestamp: e.timestamp,
      eventId: e.id,
      cutoffTimestamp: cutoff.timestamp,
      cutoffEventId: cutoff.eventId,
    })
  ) {
    return eventsApplied;
  }
  accumulator.apply(e);
  const nextApplied = eventsApplied + 1;
  onProgress(nextApplied);
  return nextApplied;
}

/**
 * Streams one batch of a tenant's aggregates through the shared accumulator,
 * bounded by each aggregate's cutoff so the read is a stable point-in-time
 * snapshot (and prunes event_log's weekly partitions via occurred-at bounds).
 */
async function replayStateBatch({
  client,
  projection,
  batch,
  tenantId,
  batchSize,
  accumulator,
  onProgress,
}: {
  client: ClickHouseClient;
  projection: RegisteredStateProjection;
  batch: DiscoveredAggregate[];
  tenantId: string;
  batchSize: number;
  accumulator: StateAccumulator;
  onProgress: (eventsProcessed: number) => void;
}): Promise<number> {
  const eventTypes = projection.definition.eventTypes;

  const { cutoffs, occurredAtBounds } = await getBoundedCutoffs({
    client,
    tenantId,
    aggregateTypes: [...new Set(batch.map((a) => a.aggregateType))],
    aggregateIds: batch.map((a) => a.aggregateId),
    eventTypes,
  });

  if (cutoffs.size === 0) return 0;

  const maxCutoff = maxEventPosition(cutoffs.values());
  const aggregateIds = batch
    .filter((a) => cutoffs.has(aggregateKey(a)))
    .map((a) => a.aggregateId);

  let cursor: { timestamp: number; eventId: string } | undefined;
  let eventsApplied = 0;

  for (;;) {
    const events = await batchLoadAggregateEvents({
      client,
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
      eventsApplied = applyStateEventIfWithinCutoff({
        event: e,
        cutoffs,
        accumulator,
        eventsApplied,
        onProgress,
      });
    }

    const lastEvent = events[events.length - 1];
    if (lastEvent) {
      cursor = { timestamp: lastEvent.timestamp, eventId: lastEvent.id };
    }
    if (events.length < batchSize) break;
  }

  return eventsApplied;
}
