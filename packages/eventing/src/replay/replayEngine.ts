import { pMapLimited } from "./pMapLimited";
import {
  pauseProjection,
  unpauseProjection,
  waitForAllActiveJobs,
} from "./replayDrain";
import type {
  CutoffInfo,
  DiscoveredAggregate,
  OccurredAtBounds,
  ReplayEvent,
} from "./replayEventSource";
import { FoldAccumulator, MapAccumulator } from "./replayExecutor";
import type { ReplayLogWriter } from "./replayLog";
import { nullLog } from "./replayLog";
import {
  aggregateKey,
  cleanupAll,
  clearFailedBatchMarkers,
  getCompletedSets,
  markCompletedForProjections,
  markCutoffForProjections,
  markPendingForProjections,
  unmarkForProjections,
} from "./replayMarkers";
import type {
  BatchPhase,
  ProjectionKind,
  RegisteredFoldProjection,
  RegisteredMapProjection,
  ReplayCallbacks,
  ReplayConfig,
  ReplayContext,
  ReplayProgress,
  ReplayResult,
} from "./types";

/**
 * Emit replay-phase progress once per this many applied events (plus once at
 * each phase transition). Every emit fans out to the progress callback — which
 * the ops layer persists to Redis in multiple round trips — so per-event (or
 * per-aggregate) emits hammered Redis for no operator benefit.
 */
const PROGRESS_EMIT_EVERY_EVENTS = 5000;

interface AggregateEntry {
  tenantId: string;
  aggregateId: string;
  aggregateType: string;
  projections: string[];
}

type AggregateProjectionMap = Map<string, AggregateEntry>;

type EmitFn = (phase: BatchPhase, eventsProcessed?: number) => void;

interface SelectedProjections {
  allEventTypes: string[];
  allProjectionNames: string[];
  eventTypesByProjection: Map<string, Set<string>>;
  projectionByName: Map<string, RegisteredFoldProjection>;
  mapProjectionByName: Map<string, RegisteredMapProjection>;
  allProjectionsToPause: Array<
    RegisteredFoldProjection | RegisteredMapProjection
  >;
  pausedProjectionEntries: Array<{
    projectionName: string;
    kind: ProjectionKind;
  }>;
}

/** Index the selected fold + map projections every phase needs to consult. */
function collectSelectedProjections(config: ReplayConfig): SelectedProjections {
  const mapProjections = config.mapProjections ?? [];
  const allEventTypes = new Set<string>();
  const eventTypesByProjection = new Map<string, Set<string>>();
  const projectionByName = new Map<string, RegisteredFoldProjection>();
  const mapProjectionByName = new Map<string, RegisteredMapProjection>();

  for (const p of config.projections) {
    projectionByName.set(p.projectionName, p);
  }
  for (const p of mapProjections) {
    mapProjectionByName.set(p.projectionName, p);
  }
  for (const p of [...config.projections, ...mapProjections]) {
    for (const et of p.definition.eventTypes) allEventTypes.add(et);
    eventTypesByProjection.set(
      p.projectionName,
      new Set(p.definition.eventTypes),
    );
  }

  const allProjectionsToPause = [...config.projections, ...mapProjections];
  return {
    allEventTypes: [...allEventTypes],
    allProjectionNames: allProjectionsToPause.map((p) => p.projectionName),
    eventTypesByProjection,
    projectionByName,
    mapProjectionByName,
    allProjectionsToPause,
    pausedProjectionEntries: allProjectionsToPause.map((p) => ({
      projectionName: p.projectionName,
      kind: p.kind,
    })),
  };
}

/** The selected projections whose declared event types occur on an aggregate. */
function matchProjectionsForAggregate({
  aggEventTypes,
  selected,
}: {
  aggEventTypes: Set<string>;
  selected: SelectedProjections;
}): string[] {
  return selected.allProjectionNames.filter((projName) => {
    const projEventTypes = selected.eventTypesByProjection.get(projName)!;
    for (const et of aggEventTypes) {
      if (projEventTypes.has(et)) return true;
    }
    return false;
  });
}

/** Drop aggregates outside a caller-supplied allow-list (scoped replay). */
function filterToRequestedAggregates({
  aggregateProjectionMap,
  aggregateIds,
}: {
  aggregateProjectionMap: AggregateProjectionMap;
  aggregateIds?: string[];
}): void {
  if (!aggregateIds || aggregateIds.length === 0) return;
  const allowedIds = new Set(aggregateIds);
  for (const [key, entry] of aggregateProjectionMap) {
    if (!allowedIds.has(entry.aggregateId)) {
      aggregateProjectionMap.delete(key);
    }
  }
}

/** Discover one tenant's affected aggregates into the shared map. */
async function discoverTenantAggregates({
  ctx,
  config,
  selected,
  tenantId,
  aggregateProjectionMap,
}: {
  ctx: ReplayContext;
  config: ReplayConfig;
  selected: SelectedProjections;
  tenantId: string | undefined;
  aggregateProjectionMap: AggregateProjectionMap;
}): Promise<void> {
  const aggregates = await ctx.eventSource.discoverAffectedAggregates({
    eventTypes: selected.allEventTypes,
    sinceMs: new Date(config.since).getTime(),
    tenantId,
  });
  for (const agg of aggregates) {
    const key = aggregateKey(agg);
    if (aggregateProjectionMap.has(key)) continue;
    const matchedProjections = matchProjectionsForAggregate({
      aggEventTypes: new Set(agg.eventTypes),
      selected,
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

/**
 * One discovery pass over the union of all selected event types, attaching to
 * each aggregate only the projections whose event types actually occur on it.
 * Without that filter, every aggregate would get cutoff/pending markers (and
 * completion requirements) for unrelated projections sharing no event types.
 */
async function discoverAggregateProjections({
  ctx,
  config,
  selected,
}: {
  ctx: ReplayContext;
  config: ReplayConfig;
  selected: SelectedProjections;
}): Promise<AggregateProjectionMap> {
  const aggregateProjectionMap: AggregateProjectionMap = new Map();
  const discoveryTargets =
    config.tenantIds.length > 0 ? config.tenantIds : [undefined];

  for (const tenantId of discoveryTargets) {
    await discoverTenantAggregates({
      ctx,
      config,
      selected,
      tenantId,
      aggregateProjectionMap,
    });
  }

  filterToRequestedAggregates({
    aggregateProjectionMap,
    aggregateIds: config.aggregateIds,
  });
  return aggregateProjectionMap;
}

/**
 * Resume support: split discovered aggregates into those completed for ALL
 * their relevant projections (skipped) and those still to replay.
 */
async function filterAlreadyCompleted({
  ctx,
  aggregateProjectionMap,
  allProjectionNames,
}: {
  ctx: ReplayContext;
  aggregateProjectionMap: AggregateProjectionMap;
  allProjectionNames: string[];
}): Promise<{ remaining: string[]; skippedCount: number }> {
  const completedSets = await getCompletedSets({
    redis: ctx.redis,
    projectionNames: allProjectionNames,
  });

  const remaining: string[] = [];
  let skippedCount = 0;
  for (const [key, entry] of aggregateProjectionMap) {
    const allCompleted = entry.projections.every(
      (projName) => completedSets.get(projName)?.has(key) ?? false,
    );
    if (allCompleted) skippedCount++;
    else remaining.push(key);
  }
  return { remaining, skippedCount };
}

/**
 * The fold/map replay engine: one discovery pass over the union of all
 * selected projections' event types, then per-batch
 * mark/pause/drain/cutoff/unpause/stream/write/complete, loading each batch's
 * events exactly once for every projection.
 *
 * The pause window covers only mark → drain → cutoff (ADR-015, amended): once
 * an aggregate's cutoff marker is recorded, the live checker skips its events
 * at/before the cutoff and defers anything newer, so the rebuild's load and
 * writes run with the queue flowing. Events stream straight from ClickHouse
 * into the accumulators — filtered to the union of selected event types, so
 * payload bytes no projection consumes are never read — and memory stays
 * bounded by fold states plus the map write buffer, never the batch's event
 * count.
 */
export async function runFoldMapReplay({
  ctx,
  config,
  callbacks,
}: {
  ctx: ReplayContext;
  config: ReplayConfig;
  callbacks?: ReplayCallbacks & { log?: ReplayLogWriter };
}): Promise<ReplayResult> {
  // State projections are not supported here: a state projection is a
  // from-init operational rebuild keyed across aggregates with its own
  // projection-wide pause, not a per-batch marker protocol. Fail loudly
  // rather than silently dropping them — ReplayService.replay routes them
  // through the state lane.
  if (config.stateProjections && config.stateProjections.length > 0) {
    throw new Error(
      `The fold/map replay engine does not support state projections (${config.stateProjections
        .map((p) => p.projectionName)
        .join(", ")}); run them through ReplayService.replay`,
    );
  }

  return new FoldMapReplayRun({ ctx, config, callbacks }).run();
}

/**
 * One engine invocation's shared state: the selection indexes, the discovered
 * aggregate → projections map, and the running totals every batch advances.
 */
class FoldMapReplayRun {
  private readonly ctx: ReplayContext;
  private readonly config: ReplayConfig;
  private readonly callbacks?: ReplayCallbacks & { log?: ReplayLogWriter };
  private readonly log: ReplayLogWriter;
  private readonly selected: SelectedProjections;
  private readonly aggregateBatchSize: number;
  private readonly concurrency: number;
  private readonly runProjectionKind: ProjectionKind;
  private readonly startTime = Date.now();
  private readonly touchedTenants = new Set<string>();

  private aggregateProjectionMap: AggregateProjectionMap = new Map();
  private totalEventsReplayed = 0;
  private totalBatchErrors = 0;
  private firstError: string | undefined;
  private skippedCount = 0;
  private aggregatesCompleted = 0;
  private totalBatches = 0;
  private runTenantCount = 0;

  constructor({
    ctx,
    config,
    callbacks,
  }: {
    ctx: ReplayContext;
    config: ReplayConfig;
    callbacks?: ReplayCallbacks & { log?: ReplayLogWriter };
  }) {
    this.ctx = ctx;
    this.config = config;
    this.callbacks = callbacks;
    this.log = callbacks?.log ?? nullLog;
    this.selected = collectSelectedProjections(config);
    this.aggregateBatchSize = config.aggregateBatchSize ?? 1000;
    this.concurrency = config.concurrency ?? 10;
    // "map" for map-only runs, otherwise "fold" (fold-only and mixed runs —
    // fold is the dominant kind).
    this.runProjectionKind =
      config.projections.length === 0 &&
      (config.mapProjections ?? []).length > 0
        ? "map"
        : "fold";
  }

  async run(): Promise<ReplayResult> {
    this.aggregateProjectionMap = await discoverAggregateProjections({
      ctx: this.ctx,
      config: this.config,
      selected: this.selected,
    });
    if (this.aggregateProjectionMap.size === 0 || this.config.dryRun) {
      return { aggregatesReplayed: 0, totalEvents: 0, batchErrors: 0 };
    }

    const { remaining, skippedCount } = await filterAlreadyCompleted({
      ctx: this.ctx,
      aggregateProjectionMap: this.aggregateProjectionMap,
      allProjectionNames: this.selected.allProjectionNames,
    });
    if (remaining.length === 0) {
      return { aggregatesReplayed: 0, totalEvents: 0, batchErrors: 0 };
    }
    this.skippedCount = skippedCount;
    this.aggregatesCompleted = skippedCount;
    this.totalBatches = Math.ceil(remaining.length / this.aggregateBatchSize);
    this.runTenantCount = new Set(
      remaining.map((key) => this.aggregateProjectionMap.get(key)!.tenantId),
    ).size;

    for (let i = 0; i < remaining.length; i += this.aggregateBatchSize) {
      const batchKeys = remaining.slice(i, i + this.aggregateBatchSize);
      const batchNum = Math.floor(i / this.aggregateBatchSize) + 1;
      const completed = await this.runOneBatch({ batchKeys, batchNum });
      if (!completed) return this.result();
    }

    for (const name of this.selected.allProjectionNames) {
      await cleanupAll({ redis: this.ctx.redis, projectionName: name });
    }

    if (this.totalEventsReplayed > 0 && this.totalBatchErrors === 0) {
      await optimizeTouchedTables({
        ctx: this.ctx,
        projections: this.selected.allProjectionsToPause,
        touchedTenants: this.touchedTenants,
        concurrency: this.concurrency,
        log: this.log,
      });
    }

    return this.result();
  }

  private result(): ReplayResult {
    return {
      aggregatesReplayed: this.aggregatesCompleted - this.skippedCount,
      totalEvents: this.totalEventsReplayed,
      batchErrors: this.totalBatchErrors,
      firstError: this.firstError,
    };
  }

  private buildProgress({
    batchKeys,
    batchNum,
  }: {
    batchKeys: string[];
    batchNum: number;
  }): ReplayProgress {
    return {
      phase: "replaying",
      currentProjectionName: this.selected.allProjectionNames.join("+"),
      currentProjectionKind: this.runProjectionKind,
      currentProjectionIndex: 0,
      totalProjections: this.selected.allProjectionNames.length,
      totalAggregates: this.aggregateProjectionMap.size,
      tenantCount: this.runTenantCount,
      currentBatch: batchNum,
      totalBatches: this.totalBatches,
      batchAggregates: batchKeys.length,
      batchPhase: "mark",
      batchEventsProcessed: 0,
      aggregatesCompleted: this.aggregatesCompleted,
      totalEventsReplayed: this.totalEventsReplayed,
      elapsedSec: (Date.now() - this.startTime) / 1000,
      skippedCount: this.skippedCount,
      batchErrors: this.totalBatchErrors,
      firstError: this.firstError,
    };
  }

  /** Returns false when the batch failed and the run must stop. */
  private async runOneBatch({
    batchKeys,
    batchNum,
  }: {
    batchKeys: string[];
    batchNum: number;
  }): Promise<boolean> {
    const batchStartTime = Date.now();
    const progress = this.buildProgress({ batchKeys, batchNum });
    const emit: EmitFn = (phase, eventsProcessed) => {
      progress.batchPhase = phase;
      if (eventsProcessed !== undefined) {
        progress.batchEventsProcessed = eventsProcessed;
        progress.totalEventsReplayed =
          this.totalEventsReplayed + eventsProcessed;
      }
      progress.elapsedSec = (Date.now() - this.startTime) / 1000;
      this.callbacks?.onProgress?.({ ...progress });
    };

    let batchResult: { eventsReplayed: number };
    try {
      batchResult = await replayBatch({
        ctx: this.ctx,
        batchKeys,
        aggregateProjectionMap: this.aggregateProjectionMap,
        selected: this.selected,
        concurrency: this.concurrency,
        batchNum,
        log: this.log,
        emit,
      });
    } catch (error) {
      await this.handleBatchFailure({ error, batchKeys, batchNum, progress });
      return false;
    }

    this.totalEventsReplayed += batchResult.eventsReplayed;
    this.aggregatesCompleted += batchKeys.length;
    for (const key of batchKeys) {
      this.touchedTenants.add(this.aggregateProjectionMap.get(key)!.tenantId);
    }

    this.callbacks?.onBatchComplete?.({
      projectionName: this.selected.allProjectionNames.join("+"),
      projectionKind: this.runProjectionKind,
      batchNum,
      totalBatches: this.totalBatches,
      aggregatesInBatch: batchKeys.length,
      eventsInBatch: batchResult.eventsReplayed,
      durationSec: (Date.now() - batchStartTime) / 1000,
    });
    return true;
  }

  private async handleBatchFailure({
    error,
    batchKeys,
    batchNum,
    progress,
  }: {
    error: unknown;
    batchKeys: string[];
    batchNum: number;
    progress: ReplayProgress;
  }): Promise<void> {
    this.totalBatchErrors++;
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (!this.firstError) this.firstError = errorMsg;
    this.log.write({ step: "error", batch: batchNum, error: errorMsg });

    // Before the emit below — cancellation can throw from onProgress, and the
    // failed batch's markers must be gone either way. Extra HDELs for
    // projections an aggregate wasn't marked for are no-ops.
    await clearFailedBatchMarkers({
      redis: this.ctx.redis,
      projectionNames: this.selected.allProjectionNames,
      aggKeys: batchKeys,
      log: this.log,
    });

    progress.batchErrors = this.totalBatchErrors;
    progress.firstError = this.firstError;
    progress.elapsedSec = (Date.now() - this.startTime) / 1000;
    // Deliberately unguarded: a cancellation rethrow from this emit is how
    // ReplayCancelledError reaches the caller — the batch's markers are
    // already cleared above, so propagating is safe and required.
    this.callbacks?.onProgress?.({ ...progress });
  }
}

/**
 * Nudge ReplacingMergeTree to merge each touched table sooner, per touched
 * tenant database, tenants in parallel. No FINAL; non-fatal — merge happens
 * eventually either way.
 */
export async function optimizeTouchedTables({
  ctx,
  projections,
  touchedTenants,
  concurrency,
  log,
}: {
  ctx: ReplayContext;
  projections: Array<{ targetTable?: string }>;
  touchedTenants: Set<string>;
  concurrency: number;
  log: ReplayLogWriter;
}): Promise<void> {
  const tables = new Set<string>();
  for (const p of projections) {
    if (p.targetTable) tables.add(p.targetTable);
  }
  if (tables.size === 0) return;
  const optimizeTables = ctx.eventSource.optimizeTables;
  if (!optimizeTables) return;

  const tenantTargets =
    touchedTenants.size > 0 ? [...touchedTenants] : ["default"];

  await pMapLimited({
    items: tenantTargets,
    fn: async (tenantId) => {
      try {
        await optimizeTables(tenantId, [...tables]);
        for (const table of tables) {
          log.write({ step: "optimize", table, tenant: tenantId });
        }
      } catch {
        // Non-fatal — merge will happen eventually
      }
    },
    concurrency,
  });
}

interface BatchGroups {
  projNames: string[];
  aggKeysByProjection: Map<string, string[]>;
  byTenant: Map<
    string,
    Array<{ key: string; aggregateId: string; aggregateType: string }>
  >;
  batchAggregates: DiscoveredAggregate[];
}

/** Group a batch's aggregate keys per projection and per tenant. */
function groupBatch({
  batchKeys,
  aggregateProjectionMap,
}: {
  batchKeys: string[];
  aggregateProjectionMap: AggregateProjectionMap;
}): BatchGroups {
  const aggKeysByProjection = new Map<string, string[]>();
  const byTenant: BatchGroups["byTenant"] = new Map();
  const batchAggregates: DiscoveredAggregate[] = [];

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
    let tenantList = byTenant.get(entry.tenantId);
    if (!tenantList) {
      tenantList = [];
      byTenant.set(entry.tenantId, tenantList);
    }
    tenantList.push({
      key,
      aggregateId: entry.aggregateId,
      aggregateType: entry.aggregateType,
    });
    batchAggregates.push({
      tenantId: entry.tenantId,
      aggregateType: entry.aggregateType,
      aggregateId: entry.aggregateId,
    });
  }

  return {
    projNames: [...aggKeysByProjection.keys()],
    aggKeysByProjection,
    byTenant,
    batchAggregates,
  };
}

/** Mark pending, pause every selected projection, and drain in-flight jobs. */
async function markPauseAndDrain({
  ctx,
  groups,
  selected,
  batchNum,
  log,
  emit,
}: {
  ctx: ReplayContext;
  groups: BatchGroups;
  selected: SelectedProjections;
  batchNum: number;
  log: ReplayLogWriter;
  emit: EmitFn;
}): Promise<void> {
  // MARK each projection for its matching aggregates, before pausing: a job
  // dispatched in the gap defers on the pending marker.
  emit("mark");
  await markPendingForProjections({
    redis: ctx.redis,
    aggKeysByProjection: groups.aggKeysByProjection,
  });
  log.write({
    step: "mark-batch-multi",
    count: groups.batchAggregates.length,
    projections: groups.projNames,
  });

  emit("pause");
  for (const p of selected.allProjectionsToPause) {
    await pauseProjection({ redis: ctx.redis, pauseKey: p.pauseKey });
  }
  log.write({
    step: "pause-batch",
    batch: batchNum,
    projections: groups.projNames,
  });

  // DRAIN only THIS batch's aggregates — not every discovered aggregate.
  emit("drain");
  await waitForAllActiveJobs({
    redis: ctx.redis,
    aggregates: groups.batchAggregates,
    projections: selected.pausedProjectionEntries,
  });
  log.write({
    step: "drain-batch",
    batch: batchNum,
    aggregateCount: groups.batchAggregates.length,
  });
}

/**
 * Compute each tenant's occurred-at bounds and cutoffs (in parallel), record
 * cutoff markers for aggregates with events, and unmark the rest. Bounds
 * first so the cutoff and load queries prune event_log's weekly partitions;
 * see getAggregateOccurredAtBounds for the safety argument.
 */
async function computeAndRecordCutoffs({
  ctx,
  groups,
  selected,
  concurrency,
  emit,
}: {
  ctx: ReplayContext;
  groups: BatchGroups;
  selected: SelectedProjections;
  concurrency: number;
  emit: EmitFn;
}): Promise<{
  allCutoffs: Map<string, CutoffInfo>;
  boundsByTenant: Map<string, OccurredAtBounds>;
}> {
  emit("cutoff");
  const allCutoffs = new Map<string, CutoffInfo>();
  const boundsByTenant = new Map<string, OccurredAtBounds>();

  await pMapLimited({
    items: [...groups.byTenant.entries()],
    fn: async ([tenantId, entries]) => {
      const { cutoffs: tenantCutoffs, occurredAtBounds } =
        await ctx.eventSource.getBoundedCutoffs({
          tenantId,
          aggregateTypes: [...new Set(entries.map((e) => e.aggregateType))],
          aggregateIds: entries.map((e) => e.aggregateId),
          eventTypes: selected.allEventTypes,
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
  });

  // Record cutoffs for aggregates with events; unmark the rest. One pipeline
  // each, covering every projection.
  const cutoffsByProjection = new Map<string, Map<string, CutoffInfo>>();
  const noEventKeysByProjection = new Map<string, string[]>();
  for (const [projName, projAggKeys] of groups.aggKeysByProjection) {
    const projCutoffs = new Map<string, CutoffInfo>();
    const noEventKeys: string[] = [];
    for (const key of projAggKeys) {
      const cutoff = allCutoffs.get(key);
      if (cutoff) projCutoffs.set(key, cutoff);
      else noEventKeys.push(key);
    }
    cutoffsByProjection.set(projName, projCutoffs);
    noEventKeysByProjection.set(projName, noEventKeys);
  }
  await markCutoffForProjections({ redis: ctx.redis, cutoffsByProjection });
  await unmarkForProjections({
    redis: ctx.redis,
    aggKeysByProjection: noEventKeysByProjection,
  });

  return { allCutoffs, boundsByTenant };
}

/** Unpause every selected projection, logging (never throwing) on failure. */
async function unpauseAll({
  ctx,
  selected,
  groups,
  batchNum,
  log,
}: {
  ctx: ReplayContext;
  selected: SelectedProjections;
  groups: BatchGroups;
  batchNum: number;
  log: ReplayLogWriter;
}): Promise<void> {
  for (const p of selected.allProjectionsToPause) {
    await unpauseProjection({ redis: ctx.redis, pauseKey: p.pauseKey }).catch(
      (unpauseError) => {
        log.write({
          step: "error",
          batch: batchNum,
          error: `unpause failed: ${
            unpauseError instanceof Error
              ? unpauseError.message
              : String(unpauseError)
          }`,
        });
      },
    );
  }
  log.write({
    step: "unpause-batch",
    batch: batchNum,
    projections: groups.projNames,
  });
}

/**
 * The paused section of a batch: mark → pause → drain → cutoff, unpausing in
 * a finally either way. This is the ONLY window in which the projections'
 * live queues are frozen — once the cutoff markers are recorded, the live
 * checker skips/defers the batch's aggregates on its own (ADR-015, amended).
 */
async function markDrainAndCutoff({
  ctx,
  groups,
  selected,
  concurrency,
  batchNum,
  log,
  emit,
}: {
  ctx: ReplayContext;
  groups: BatchGroups;
  selected: SelectedProjections;
  concurrency: number;
  batchNum: number;
  log: ReplayLogWriter;
  emit: EmitFn;
}): Promise<{
  allCutoffs: Map<string, CutoffInfo>;
  boundsByTenant: Map<string, OccurredAtBounds>;
}> {
  try {
    await markPauseAndDrain({ ctx, groups, selected, batchNum, log, emit });
    return await computeAndRecordCutoffs({
      ctx,
      groups,
      selected,
      concurrency,
      emit,
    });
  } finally {
    // Unpause after the cutoff is recorded — or on ANY failure in the paused
    // section — so live processing can never be left frozen. Unpausing a
    // never-paused projection is an idempotent SREM.
    await unpauseAll({ ctx, selected, groups, batchNum, log });
  }
}

interface BatchAccumulators {
  foldAccumulators: Map<string, FoldAccumulator>;
  mapAccumulators: Map<string, MapAccumulator>;
}

/** One accumulator per selected projection present in this batch. */
function buildAccumulators({
  ctx,
  groups,
  selected,
}: {
  ctx: ReplayContext;
  groups: BatchGroups;
  selected: SelectedProjections;
}): BatchAccumulators {
  const foldAccumulators = new Map<string, FoldAccumulator>();
  const mapAccumulators = new Map<string, MapAccumulator>();
  for (const projName of groups.projNames) {
    const foldProj = selected.projectionByName.get(projName);
    if (foldProj) {
      foldAccumulators.set(
        projName,
        new FoldAccumulator(foldProj.definition, ctx.accumulatorOpts),
      );
    }
    const mapProj = selected.mapProjectionByName.get(projName);
    if (mapProj) {
      mapAccumulators.set(
        projName,
        new MapAccumulator(mapProj.definition, ctx.accumulatorOpts),
      );
    }
  }
  return { foldAccumulators, mapAccumulators };
}

/**
 * Feed one event to every accumulator of its aggregate's projections,
 * returning any map drains that came due (the only awaits on the hot path).
 */
function applyEventToProjections({
  entry,
  accumulators,
  event,
}: {
  entry: AggregateEntry;
  accumulators: BatchAccumulators;
  event: ReplayEvent;
}): Promise<void>[] | undefined {
  let pendingDrains: Promise<void>[] | undefined;
  for (const projName of entry.projections) {
    accumulators.foldAccumulators.get(projName)?.apply(event);
    const mapAcc = accumulators.mapAccumulators.get(projName);
    if (mapAcc) {
      mapAcc.apply(event);
      const drain = mapAcc.drainIfNeeded();
      if (drain) (pendingDrains ??= []).push(drain);
    }
  }
  return pendingDrains;
}

/**
 * Build the per-event apply function the tenant streams share: feed every
 * relevant accumulator, count, throttle progress emits, and surface map
 * drains as the ONLY awaits on the hot path.
 */
function makeOnEvent({
  aggregateProjectionMap,
  accumulators,
  counter,
  emit,
}: {
  aggregateProjectionMap: AggregateProjectionMap;
  accumulators: BatchAccumulators;
  counter: { eventsProcessed: number };
  emit: EmitFn;
}): (event: ReplayEvent) => void | Promise<void> {
  return (event) => {
    const key = aggregateKey({
      tenantId: event.tenantId,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
    });
    const entry = aggregateProjectionMap.get(key);
    if (!entry) return;

    const pendingDrains = applyEventToProjections({
      entry,
      accumulators,
      event,
    });

    counter.eventsProcessed++;
    // Throttled progress: never once per event — each emit persists status
    // to Redis in multiple round trips.
    if (counter.eventsProcessed % PROGRESS_EMIT_EVERY_EVENTS === 0) {
      emit("replay", counter.eventsProcessed);
    }

    if (!pendingDrains) return;
    return pendingDrains.length === 1
      ? pendingDrains[0]
      : Promise.all(pendingDrains).then(() => undefined);
  };
}

/**
 * The unpaused replay section: stream every tenant's events (in parallel,
 * union-typed, cutoff-filtered) straight into one accumulator per projection,
 * then flush. The batch's aggregates stay protected by their cutoff markers,
 * not the pause.
 */
async function streamApplyAndWrite({
  ctx,
  groups,
  aggregateProjectionMap,
  selected,
  allCutoffs,
  boundsByTenant,
  concurrency,
  emit,
}: {
  ctx: ReplayContext;
  groups: BatchGroups;
  aggregateProjectionMap: AggregateProjectionMap;
  selected: SelectedProjections;
  allCutoffs: Map<string, CutoffInfo>;
  boundsByTenant: Map<string, OccurredAtBounds>;
  concurrency: number;
  emit: EmitFn;
}): Promise<{ eventsProcessed: number }> {
  emit("replay", 0);
  const accumulators = buildAccumulators({ ctx, groups, selected });
  const counter = { eventsProcessed: 0 };
  const onEvent = makeOnEvent({
    aggregateProjectionMap,
    accumulators,
    counter,
    emit,
  });

  await pMapLimited({
    items: [...groups.byTenant.entries()],
    fn: async ([tenantId, entries]) => {
      const aggIds = entries
        .filter((e) => allCutoffs.has(e.key))
        .map((e) => e.aggregateId);
      if (aggIds.length === 0) return;

      await ctx.eventSource.streamEventsForAggregates({
        tenantId,
        aggregateIds: aggIds,
        eventTypes: selected.allEventTypes,
        cutoffs: allCutoffs,
        occurredAtBounds: boundsByTenant.get(tenantId),
        onEvent,
      });
    },
    concurrency,
  });

  emit("write", counter.eventsProcessed);
  for (const [, acc] of accumulators.foldAccumulators) {
    await acc.flush();
  }
  for (const [, acc] of accumulators.mapAccumulators) {
    await acc.flush();
  }

  return { eventsProcessed: counter.eventsProcessed };
}

/**
 * Terminal transition for a replayed batch: `done:` markers per projection
 * (not HDEL), each preserving its aggregate's cutoff boundary so a job staged
 * but never active during the pause is still skipped for events at/before the
 * cutoff, instead of double-writing. One pipeline for all projections.
 */
async function recordBatchCompletion({
  ctx,
  groups,
  withCutoffKeys,
  allCutoffs,
  eventsProcessed,
  log,
  emit,
}: {
  ctx: ReplayContext;
  groups: BatchGroups;
  withCutoffKeys: string[];
  allCutoffs: Map<string, CutoffInfo>;
  eventsProcessed: number;
  log: ReplayLogWriter;
  emit: EmitFn;
}): Promise<void> {
  emit("unmark", eventsProcessed);
  const withCutoffSet = new Set(withCutoffKeys);
  const cutoffsByProjection = new Map<string, Map<string, CutoffInfo>>();
  for (const [projName, projAggKeys] of groups.aggKeysByProjection) {
    const projCutoffs = new Map<string, CutoffInfo>();
    for (const key of projAggKeys) {
      if (!withCutoffSet.has(key)) continue;
      const cutoff = allCutoffs.get(key);
      if (cutoff) projCutoffs.set(key, cutoff);
    }
    cutoffsByProjection.set(projName, projCutoffs);
  }
  await markCompletedForProjections({
    redis: ctx.redis,
    cutoffsByProjection,
  });
  log.write({
    step: "unmark-batch-multi",
    count: withCutoffKeys.length,
    projections: groups.projNames,
  });
}

async function replayBatch({
  ctx,
  batchKeys,
  aggregateProjectionMap,
  selected,
  concurrency,
  batchNum,
  log,
  emit,
}: {
  ctx: ReplayContext;
  batchKeys: string[];
  aggregateProjectionMap: AggregateProjectionMap;
  selected: SelectedProjections;
  concurrency: number;
  batchNum: number;
  log: ReplayLogWriter;
  emit: EmitFn;
}): Promise<{ eventsReplayed: number }> {
  const groups = groupBatch({ batchKeys, aggregateProjectionMap });

  const { allCutoffs, boundsByTenant } = await markDrainAndCutoff({
    ctx,
    groups,
    selected,
    concurrency,
    batchNum,
    log,
    emit,
  });

  const withCutoffKeys = batchKeys.filter((key) => allCutoffs.has(key));
  if (withCutoffKeys.length === 0) {
    emit("unmark");
    return { eventsReplayed: 0 };
  }

  const { eventsProcessed } = await streamApplyAndWrite({
    ctx,
    groups,
    aggregateProjectionMap,
    selected,
    allCutoffs,
    boundsByTenant,
    concurrency,
    emit,
  });

  log.write({
    step: "replay-batch-engine",
    aggregates: withCutoffKeys.length,
    eventsProcessed,
    projections: groups.projNames,
  });

  await recordBatchCompletion({
    ctx,
    groups,
    withCutoffKeys,
    allCutoffs,
    eventsProcessed,
    log,
    emit,
  });

  return { eventsReplayed: eventsProcessed };
}
