import type {
  RegisteredFoldProjection,
  RegisteredMapProjection,
  ReplayProgress,
  ReplayConfig,
  ReplayCallbacks,
  ReplayResult,
  BatchPhase,
  ProjectionKind,
  ReplayContext,
} from "./types";
import type { CutoffInfo, DiscoveredAggregate, ReplayEvent } from "./replayEventLoader";
import type { OccurredAtBounds } from "./replayEventLoader";
import {
  discoverAffectedAggregates,
  getBoundedCutoffs,
  loadEventsForAggregatesBulk,
} from "./replayEventLoader";
import {
  aggregateKey,
  markPendingBatch,
  markCutoffBatch,
  markCompletedBatch,
  unmarkBatch,
  clearFailedBatchMarkers,
  getCompletedSet,
  cleanupAll,
} from "./replayMarkers";
import { pauseProjection, unpauseProjection, waitForAllActiveJobs } from "./replayDrain";
import { FoldAccumulator, MapAccumulator } from "./replayExecutor";
import type { ReplayLogWriter } from "./replayLog";
import { nullLog } from "./replayLog";
import { pMapLimited } from "./pMapLimited";

/**
 * Emit replay-phase progress once per this many completed aggregates (plus
 * once at the end of the batch). Every emit fans out to the progress callback
 * — which the ops layer persists to Redis in multiple round trips — so
 * per-aggregate emits (1000/batch) hammered Redis for no operator benefit.
 */
const PROGRESS_EMIT_EVERY_AGGREGATES = 100;

/**
 * Optimized multi-projection replay: one discovery pass over the union of all
 * event types, then per-batch pause/drain/mark/cutoff/replay/write/unmark
 * across every relevant projection at once, loading each batch's events a
 * single time.
 */
export async function replayOptimized({
  ctx,
  config,
  callbacks,
}: {
  ctx: ReplayContext;
  config: ReplayConfig;
  callbacks?: ReplayCallbacks & { log?: ReplayLogWriter };
}): Promise<ReplayResult> {
  const log = callbacks?.log ?? nullLog;
  const aggregateBatchSize = config.aggregateBatchSize ?? 1000;
  const concurrency = config.concurrency ?? 10;

  const startTime = Date.now();
  let totalEventsReplayed = 0;
  let totalBatchErrors = 0;
  let firstError: string | undefined;
  const touchedTenants = new Set<string>();

  const mapProjections = config.mapProjections ?? [];

  // Progress/batch reporting kind: "map" for map-only runs, otherwise
  // "fold" (fold-only and mixed runs — fold is the dominant kind).
  const runProjectionKind: ProjectionKind =
    config.projections.length === 0 && mapProjections.length > 0 ? "map" : "fold";

  // 1. Discover: single pass using the union of all event types (fold + map)
  const allEventTypesForDiscovery = new Set<string>();
  for (const p of config.projections) {
    for (const et of p.definition.eventTypes) allEventTypesForDiscovery.add(et);
  }
  for (const p of mapProjections) {
    for (const et of p.definition.eventTypes) allEventTypesForDiscovery.add(et);
  }

  const allProjectionNames = [
    ...config.projections.map((p) => p.projectionName),
    ...mapProjections.map((p) => p.projectionName),
  ];

  // eventTypes per projection — used to attach only the projections whose
  // event types actually occur on each discovered aggregate. Without this,
  // every aggregate would get cutoff/pending markers (and completion
  // requirements) for unrelated projections that share no event types.
  const eventTypesByProjection = new Map<string, Set<string>>();
  for (const p of config.projections) {
    eventTypesByProjection.set(p.projectionName, new Set(p.definition.eventTypes));
  }
  for (const p of mapProjections) {
    eventTypesByProjection.set(p.projectionName, new Set(p.definition.eventTypes));
  }

  const aggregateProjectionMap = new Map<
    string,
    { tenantId: string; aggregateId: string; aggregateType: string; projections: string[] }
  >();

  const discoveryTargets = config.tenantIds.length > 0 ? config.tenantIds : [undefined];
  for (const tenantId of discoveryTargets) {
    const client = await ctx.resolveClient(tenantId ?? "default");
    const aggregates = await discoverAffectedAggregates({
      client,
      eventTypes: [...allEventTypesForDiscovery],
      sinceMs: new Date(config.since).getTime(),
      tenantId,
    });
    for (const agg of aggregates) {
      const key = aggregateKey(agg);
      if (!aggregateProjectionMap.has(key)) {
        const aggEventTypes = new Set(agg.eventTypes);
        const matchedProjections = allProjectionNames.filter((projName) => {
          const projEventTypes = eventTypesByProjection.get(projName)!;
          for (const et of aggEventTypes) {
            if (projEventTypes.has(et)) return true;
          }
          return false;
        });
        if (matchedProjections.length === 0) continue;
        aggregateProjectionMap.set(key, {
          tenantId: agg.tenantId,
          aggregateId: agg.aggregateId,
          aggregateType: agg.aggregateType,
          projections: matchedProjections,
        });
      }
    }
  }

  // Filter to specific aggregate IDs if provided (single-aggregate replay)
  if (config.aggregateIds && config.aggregateIds.length > 0) {
    const allowedIds = new Set(config.aggregateIds);
    for (const [key, entry] of aggregateProjectionMap) {
      if (!allowedIds.has(entry.aggregateId)) {
        aggregateProjectionMap.delete(key);
      }
    }
  }

  if (aggregateProjectionMap.size === 0) {
    return { aggregatesReplayed: 0, totalEvents: 0, batchErrors: 0 };
  }

  if (config.dryRun) {
    return { aggregatesReplayed: 0, totalEvents: 0, batchErrors: 0 };
  }

  // Build lookups from projectionName to registered projection
  const projectionByName = new Map<string, RegisteredFoldProjection>();
  for (const p of config.projections) {
    projectionByName.set(p.projectionName, p);
  }
  const mapProjectionByName = new Map<string, RegisteredMapProjection>();
  for (const p of mapProjections) {
    mapProjectionByName.set(p.projectionName, p);
  }

  // Get completed sets for all projections (fold + map)
  const completedSets = new Map<string, Set<string>>();
  for (const p of [...config.projections, ...mapProjections]) {
    const completed = await getCompletedSet({ redis: ctx.redis, projectionName: p.projectionName });
    completedSets.set(p.projectionName, completed);
  }

  // Filter out aggregates completed for ALL their relevant projections
  const allAggregateKeys = [...aggregateProjectionMap.keys()];
  const remaining: string[] = [];
  let skippedCount = 0;

  for (const key of allAggregateKeys) {
    const entry = aggregateProjectionMap.get(key)!;
    const allCompleted = entry.projections.every((projName) => {
      const completed = completedSets.get(projName);
      return completed?.has(key) ?? false;
    });
    if (allCompleted) {
      skippedCount++;
    } else {
      remaining.push(key);
    }
  }

  if (remaining.length === 0) {
    return { aggregatesReplayed: 0, totalEvents: 0, batchErrors: 0 };
  }

  // 2. Pause + drain happen PER BATCH inside the loop below (ADR-015: the
  //    pause window is "seconds per batch", not the whole run — a full-run
  //    pause froze live processing for as long as the replay took). The
  //    replay marker protocol (pending/cutoff/done) keeps replayed
  //    aggregates correct across the unpaused gaps between batches.
  const allProjectionsToPause = [...config.projections, ...mapProjections];
  const pausedProjectionEntries = allProjectionsToPause.map((p) => ({
    projectionName: p.projectionName,
    kind: p.kind,
  }));

  const runTenantCount = new Set(
    remaining.map((key) => aggregateProjectionMap.get(key)!.tenantId),
  ).size;

  const totalBatches = Math.ceil(remaining.length / aggregateBatchSize);
  let aggregatesCompleted = skippedCount;

  for (let i = 0; i < remaining.length; i += aggregateBatchSize) {
    const batchKeys = remaining.slice(i, i + aggregateBatchSize);
    const batchNum = Math.floor(i / aggregateBatchSize) + 1;
    const batchStartTime = Date.now();

    const batchAggregates: DiscoveredAggregate[] = batchKeys.map((key) => {
      const entry = aggregateProjectionMap.get(key)!;
      return {
        tenantId: entry.tenantId,
        aggregateType: entry.aggregateType,
        aggregateId: entry.aggregateId,
      };
    });

    const progress: ReplayProgress = {
      phase: "replaying",
      currentProjectionName: allProjectionNames.join("+"),
      currentProjectionKind: runProjectionKind,
      currentProjectionIndex: 0,
      totalProjections: allProjectionNames.length,
      totalAggregates: allAggregateKeys.length,
      tenantCount: runTenantCount,
      currentBatch: batchNum,
      totalBatches,
      batchAggregates: batchKeys.length,
      batchPhase: "pause",
      batchEventsProcessed: 0,
      aggregatesCompleted,
      totalEventsReplayed,
      elapsedSec: (Date.now() - startTime) / 1000,
      skippedCount,
      batchErrors: totalBatchErrors,
      firstError,
    };

    const emit = () => {
      progress.elapsedSec = (Date.now() - startTime) / 1000;
      callbacks?.onProgress?.({ ...progress });
    };

    emit();

    let batchResult: { eventsReplayed: number };
    try {
      // Pause only for this batch's window. The pause loop lives INSIDE the
      // try/finally so a mid-loop pauseProjection failure still unpauses
      // whatever was already paused (unpauseProjection is an idempotent
      // SREM, so unpausing never-paused projections is safe).
      for (const p of allProjectionsToPause) {
        await pauseProjection({
          redis: ctx.redis,
          pauseKey: p.pauseKey,
        });
      }
      log.write({
        step: "pause-batch",
        batch: batchNum,
        projections: allProjectionNames,
      });

      // Drain only THIS batch's aggregates — not every discovered aggregate.
      progress.batchPhase = "drain";
      emit();
      await waitForAllActiveJobs({
        redis: ctx.redis,
        aggregates: batchAggregates,
        projections: pausedProjectionEntries,
      });
      log.write({ step: "drain-batch", batch: batchNum, aggregateCount: batchAggregates.length });

      batchResult = await replayBatchOptimized({
        ctx,
        batchKeys,
        aggregateProjectionMap,
        projectionByName,
        mapProjectionByName,
        concurrency,
        log,
        onBatchPhase: (phase, eventsProcessed) => {
          progress.batchPhase = phase;
          if (eventsProcessed !== undefined) {
            progress.batchEventsProcessed = eventsProcessed;
            progress.totalEventsReplayed = totalEventsReplayed + eventsProcessed;
          }
          emit();
        },
      });
    } catch (error) {
      totalBatchErrors++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (!firstError) firstError = errorMsg;
      log.write({ step: "error", batch: batchNum, error: errorMsg });

      // Before the emit below — cancellation can throw from onProgress, and
      // the failed batch's markers must be gone either way. Extra HDELs for
      // projections an aggregate wasn't marked for are no-ops.
      await clearFailedBatchMarkers({
        redis: ctx.redis,
        projectionNames: allProjectionNames,
        aggKeys: batchKeys,
        log,
      });

      progress.batchErrors = totalBatchErrors;
      progress.firstError = firstError;
      emit();

      return {
        aggregatesReplayed: aggregatesCompleted - skippedCount,
        totalEvents: totalEventsReplayed,
        batchErrors: totalBatchErrors,
        firstError,
      };
    } finally {
      // Unpause after EVERY batch — including the error return above — so
      // a failed batch can never leave live processing frozen.
      for (const p of allProjectionsToPause) {
        await unpauseProjection({
          redis: ctx.redis,
          pauseKey: p.pauseKey,
        }).catch(() => {});
      }
      log.write({ step: "unpause-batch", batch: batchNum, projections: allProjectionNames });
    }

    totalEventsReplayed += batchResult.eventsReplayed;
    aggregatesCompleted += batchKeys.length;

    for (const key of batchKeys) {
      const entry = aggregateProjectionMap.get(key)!;
      touchedTenants.add(entry.tenantId);
    }

    callbacks?.onBatchComplete?.({
      projectionName: allProjectionNames.join("+"),
      projectionKind: runProjectionKind,
      batchNum,
      totalBatches,
      aggregatesInBatch: batchKeys.length,
      eventsInBatch: batchResult.eventsReplayed,
      durationSec: (Date.now() - batchStartTime) / 1000,
    });
  }

  // 3. Cleanup markers for all projections
  for (const name of allProjectionNames) {
    await cleanupAll({ redis: ctx.redis, projectionName: name });
  }

  // 4. Trigger OPTIMIZE TABLE on touched CH tables
  if (totalEventsReplayed > 0 && totalBatchErrors === 0) {
    const tables = new Set<string>();
    for (const p of config.projections) {
      if (p.targetTable) tables.add(p.targetTable);
    }
    for (const p of mapProjections) {
      if (p.targetTable) tables.add(p.targetTable);
    }

    const tenantTargets = touchedTenants.size > 0 ? [...touchedTenants] : ["default"];

    for (const tenantId of tenantTargets) {
      try {
        const client = await ctx.resolveClient(tenantId);
        for (const table of tables) {
          await client.command({ query: `OPTIMIZE TABLE ${table}` });
          log.write({ step: "optimize", table, tenant: tenantId });
        }
      } catch {
        // Non-fatal — merge will happen eventually
      }
    }
  }

  return {
    aggregatesReplayed: aggregatesCompleted - skippedCount,
    totalEvents: totalEventsReplayed,
    batchErrors: totalBatchErrors,
    firstError,
  };
}

async function replayBatchOptimized({
  ctx,
  batchKeys,
  aggregateProjectionMap,
  projectionByName,
  mapProjectionByName,
  concurrency,
  log,
  onBatchPhase,
}: {
  ctx: ReplayContext;
  batchKeys: string[];
  aggregateProjectionMap: Map<
    string,
    { tenantId: string; aggregateId: string; aggregateType: string; projections: string[] }
  >;
  projectionByName: Map<string, RegisteredFoldProjection>;
  mapProjectionByName: Map<string, RegisteredMapProjection>;
  concurrency: number;
  log: ReplayLogWriter;
  onBatchPhase: (phase: BatchPhase, eventsProcessed?: number) => void;
}): Promise<{ eventsReplayed: number }> {
  const redis = ctx.redis;

  // Group aggregate keys per projection — each aggregate only carries the
  // projections whose event types occur on it, so markers must be written
  // per (projection, matching aggregates) rather than the full cross product.
  const aggKeysByProjection = new Map<string, string[]>();
  for (const key of batchKeys) {
    const entry = aggregateProjectionMap.get(key)!;
    for (const projName of entry.projections) {
      let list = aggKeysByProjection.get(projName);
      if (!list) {
        list = [];
        aggKeysByProjection.set(projName, list);
      }
      list.push(key);
    }
  }
  const projNames = [...aggKeysByProjection.keys()];

  // 1. MARK each projection for its matching aggregates
  onBatchPhase("mark");
  for (const [projName, projAggKeys] of aggKeysByProjection) {
    await markPendingBatch({ redis, projectionName: projName, aggKeys: projAggKeys });
  }
  log.write({ step: "mark-batch-multi", count: batchKeys.length, projections: projNames });

  // 2. CUTOFF — get cutoffs per tenant, per aggregate
  onBatchPhase("cutoff");
  const byTenant = new Map<string, Array<{ key: string; aggregateId: string; aggregateType: string; projections: string[] }>>();
  for (const key of batchKeys) {
    const entry = aggregateProjectionMap.get(key)!;
    let list = byTenant.get(entry.tenantId);
    if (!list) {
      list = [];
      byTenant.set(entry.tenantId, list);
    }
    list.push({ key, aggregateId: entry.aggregateId, aggregateType: entry.aggregateType, projections: entry.projections });
  }

  // Collect ALL event types across all projections (fold + map) for cutoff queries
  const allEventTypes = new Set<string>();
  for (const projName of projNames) {
    const foldProj = projectionByName.get(projName);
    if (foldProj) {
      for (const et of foldProj.definition.eventTypes) allEventTypes.add(et);
    }
    const mapProj = mapProjectionByName.get(projName);
    if (mapProj) {
      for (const et of mapProj.definition.eventTypes) allEventTypes.add(et);
    }
  }

  // Per-tenant queries are independent — run them in parallel instead of
  // serially awaiting one tenant at a time. Each tenant first computes its
  // occurred-at bounds (cheap, key-column-only) so the cutoff and load
  // queries can prune event_log's weekly partitions; see
  // getAggregateOccurredAtBounds for the safety argument.
  const allCutoffs = new Map<string, CutoffInfo>();
  const boundsByTenant = new Map<string, OccurredAtBounds | undefined>();
  await pMapLimited(
    [...byTenant.entries()],
    async ([tenantId, entries]) => {
      const client = await ctx.resolveClient(tenantId);
      const { cutoffs: tenantCutoffs, occurredAtBounds } = await getBoundedCutoffs({
        client,
        tenantId,
        aggregateTypes: [...new Set(entries.map((e) => e.aggregateType))],
        aggregateIds: entries.map((e) => e.aggregateId),
        eventTypes: [...allEventTypes],
      });
      if (!occurredAtBounds) {
        // Zero events for this tenant's aggregates (see getBoundedCutoffs) —
        // no boundsByTenant entry and no allCutoffs entries, so these
        // aggregates fall into the without-cutoff/unmark path below.
        return;
      }
      boundsByTenant.set(tenantId, occurredAtBounds);
      for (const [k, v] of tenantCutoffs) {
        allCutoffs.set(k, v);
      }
    },
    concurrency,
  );

  // Split into with/without cutoffs
  const withCutoffKeys: string[] = [];
  const withoutCutoffKeys: string[] = [];
  for (const key of batchKeys) {
    if (allCutoffs.has(key)) {
      withCutoffKeys.push(key);
    } else {
      withoutCutoffKeys.push(key);
    }
  }

  if (withoutCutoffKeys.length > 0) {
    const withoutCutoffSet = new Set(withoutCutoffKeys);
    for (const [projName, projAggKeys] of aggKeysByProjection) {
      await unmarkBatch({
        redis,
        projectionName: projName,
        aggKeys: projAggKeys.filter((k) => withoutCutoffSet.has(k)),
      });
    }
  }

  if (withCutoffKeys.length === 0) {
    onBatchPhase("unmark");
    return { eventsReplayed: 0 };
  }

  for (const [projName, projAggKeys] of aggKeysByProjection) {
    const projCutoffs = new Map<string, CutoffInfo>();
    for (const key of projAggKeys) {
      const cutoff = allCutoffs.get(key);
      if (cutoff) projCutoffs.set(key, cutoff);
    }
    await markCutoffBatch({ redis, projectionName: projName, cutoffs: projCutoffs });
  }

  // 3. REPLAY — load events per tenant, apply all relevant projections
  onBatchPhase("replay", 0);

  // Create one accumulator per projection (fold or map)
  const foldAccumulators = new Map<string, FoldAccumulator>();
  const mapAccumulators = new Map<string, MapAccumulator>();
  for (const projName of projNames) {
    const foldProj = projectionByName.get(projName);
    if (foldProj) {
      foldAccumulators.set(projName, new FoldAccumulator(foldProj.definition, ctx.accumulatorOpts));
    }
    const mapProj = mapProjectionByName.get(projName);
    if (mapProj) {
      mapAccumulators.set(projName, new MapAccumulator(mapProj.definition, ctx.accumulatorOpts));
    }
  }

  // Load events grouped by tenant (one CH query per tenant, in parallel).
  const allEvents = new Map<string, ReplayEvent[]>();

  await pMapLimited(
    [...byTenant.entries()],
    async ([tenantId, entries]) => {
      const aggIds = entries
        .filter((e) => allCutoffs.has(e.key))
        .map((e) => e.aggregateId);

      if (aggIds.length === 0) return;

      const client = await ctx.resolveClient(tenantId);
      const tenantEvents = await loadEventsForAggregatesBulk({
        client,
        tenantId,
        aggregateIds: aggIds,
        cutoffs: allCutoffs,
        occurredAtBounds: boundsByTenant.get(tenantId),
      });

      for (const [aggKey, events] of tenantEvents) {
        allEvents.set(aggKey, events);
      }
    },
    concurrency,
  );

  // Apply all relevant projections per aggregate — with concurrency
  let eventsProcessed = 0;
  let aggregatesApplied = 0;
  const totalToApply = withCutoffKeys.length;

  await pMapLimited(withCutoffKeys, async (aggKey) => {
    const events = allEvents.get(aggKey) ?? [];
    const entry = aggregateProjectionMap.get(aggKey)!;

    for (const event of events) {
      for (const projName of entry.projections) {
        const foldAcc = foldAccumulators.get(projName);
        if (foldAcc) foldAcc.apply(event);

        const mapAcc = mapAccumulators.get(projName);
        if (mapAcc) await mapAcc.apply(event);
      }
      eventsProcessed++;
    }

    // Throttled progress: emit every N aggregates plus the batch's last —
    // never once per aggregate (each emit persists status to Redis).
    aggregatesApplied++;
    if (
      aggregatesApplied % PROGRESS_EMIT_EVERY_AGGREGATES === 0 ||
      aggregatesApplied === totalToApply
    ) {
      onBatchPhase("replay", eventsProcessed);
    }
  }, concurrency);

  // 4. WRITE — flush all accumulators (fold states + map records in bulk)
  onBatchPhase("write", eventsProcessed);
  for (const [_projName, acc] of foldAccumulators) {
    await acc.flush();
  }
  for (const [_projName, acc] of mapAccumulators) {
    await acc.flush();
  }

  log.write({
    step: "replay-batch-optimized",
    aggregates: withCutoffKeys.length,
    eventsProcessed,
    projections: projNames,
  });

  // 5. COMPLETE — terminal `done:` markers per projection (not HDEL), each
  //    preserving its aggregate's cutoff boundary so a job staged but never
  //    active during the pause is still skipped for events at/before the
  //    cutoff after unpause. See the fold path for the full rationale.
  onBatchPhase("unmark", eventsProcessed);
  const withCutoffSet = new Set(withCutoffKeys);
  for (const [projName, projAggKeys] of aggKeysByProjection) {
    const projCutoffs = new Map<string, CutoffInfo>();
    for (const key of projAggKeys) {
      if (!withCutoffSet.has(key)) continue;
      const cutoff = allCutoffs.get(key);
      if (cutoff) projCutoffs.set(key, cutoff);
    }
    await markCompletedBatch({ redis, projectionName: projName, cutoffs: projCutoffs });
  }
  log.write({ step: "unmark-batch-multi", count: withCutoffKeys.length, projections: projNames });

  return { eventsReplayed: eventsProcessed };
}
