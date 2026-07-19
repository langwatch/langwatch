import type { ClickHouseClient } from "@clickhouse/client";
import type {
  RegisteredStateProjection,
  ReplayProgress,
  ReplayResult,
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
import { aggregateKey } from "./replayMarkers";
import { StateAccumulator } from "./replayExecutor";
import type { ReplayLogWriter } from "./replayLog";
import {
  pauseProjection,
  unpauseProjection,
  waitForActiveJobs,
} from "./replayDrain";
import {
  discoverProjectionAggregates,
  filterDiscoveredByAggregateIds,
} from "./replayDiscovery";

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
    // One accumulator per tenant: a projection key may group several aggregates,
    // so we fold the whole tenant before writing one row per key.
    const accumulator = new StateAccumulator(
      projection.definition,
      ctx.accumulatorOpts,
    );

    const totalBatches = Math.ceil(
      tenantAggregates.length / aggregateBatchSize,
    );

    try {
      const client = await ctx.resolveClient(tenantId);
      for (let i = 0; i < tenantAggregates.length; i += aggregateBatchSize) {
        const batch = tenantAggregates.slice(i, i + aggregateBatchSize);
        const batchNum = Math.floor(i / aggregateBatchSize) + 1;
        const batchStartTime = Date.now();

        const emit = (
          batchPhase: ReplayProgress["batchPhase"],
          batchEventsProcessed: number,
        ) => {
          const progress: ReplayProgress = {
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
            elapsedSec: (Date.now() - startTime) / 1000,
            skippedCount: 0,
            batchErrors,
            firstError,
          };
          onProgress?.(progress);
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

        totalEventsReplayed += eventsInBatch;
        aggregatesCompleted += batch.length;

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

      // WRITE — one StoredProjection per key for this tenant, from init().
      await accumulator.flush();
      log.write({
        step: "replay-state-tenant",
        tenant: tenantId,
        count: tenantAggregates.length,
      });
    } catch (error) {
      batchErrors++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (!firstError) firstError = errorMsg;
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
        aggregatesReplayed: aggregatesCompleted,
        totalEvents: totalEventsReplayed,
        batchErrors,
        firstError,
        touchedTenants: tenants.map(([tid]) => tid),
      };
    }
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
