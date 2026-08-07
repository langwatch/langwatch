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
} from "./replayEventLoader";
import {
  discoverAffectedAggregates,
  getBoundedCutoffs,
  loadEventsForAggregatesBulk,
} from "./replayEventLoader";
import { FoldAccumulator, MapAccumulator } from "./replayExecutor";
import type { ReplayLogWriter } from "./replayLog";
import { nullLog } from "./replayLog";
import {
  aggregateKey,
  cleanupAll,
  clearFailedBatchMarkers,
  getCompletedSet,
  markCompletedBatch,
  markCutoffBatch,
  markPendingBatch,
  unmarkBatch,
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
 * Emit replay-phase progress once per this many completed aggregates (plus
 * once at the end of the batch). Every emit fans out to the progress callback
 * — which the ops layer persists to Redis in multiple round trips — so
 * per-aggregate emits (1000/batch) hammered Redis for no operator benefit.
 */
const PROGRESS_EMIT_EVERY_AGGREGATES = 100;

/** One discovered aggregate and the projections whose event types occur on it. */
interface OptimizedAggregateEntry {
  tenantId: string;
  aggregateId: string;
  aggregateType: string;
  projections: string[];
}

/** Mutable running totals threaded (by mutation) through an optimized replay. */
interface OptimizedReplayAccumulator {
  totalEventsReplayed: number;
  totalBatchErrors: number;
  firstError: string | undefined;
  aggregatesCompleted: number;
  touchedTenants: Set<string>;
}

/**
 * State projections are not supported on the optimized path: its per-batch
 * pause/drain/marker protocol and per-aggregate accumulators assume a live,
 * in-place ClickHouse rebuild, whereas a state projection is a from-init
 * operational rebuild keyed across aggregates. Fail loudly rather than silently
 * dropping them — run state projections through `ReplayService.replay`.
 */
function assertNoStateProjections(config: ReplayConfig): void {
  if (config.stateProjections && config.stateProjections.length > 0) {
    throw new Error(
      `Optimized replay does not support state projections (${config.stateProjections
        .map((p) => p.projectionName)
        .join(", ")}); run them through the normal replay path`,
    );
  }
}

/** Union of every projection's (fold + map) event types, for the discovery query. */
function collectAllEventTypesForDiscovery(params: {
  projections: RegisteredFoldProjection[];
  mapProjections: RegisteredMapProjection[];
}): Set<string> {
  const types = new Set<string>();
  for (const p of params.projections) {
    for (const et of p.definition.eventTypes) types.add(et);
  }
  for (const p of params.mapProjections) {
    for (const et of p.definition.eventTypes) types.add(et);
  }
  return types;
}

/**
 * eventTypes per projection — used to attach only the projections whose
 * event types actually occur on each discovered aggregate. Without this,
 * every aggregate would get cutoff/pending markers (and completion
 * requirements) for unrelated projections that share no event types.
 */
function buildEventTypesByProjection(params: {
  projections: RegisteredFoldProjection[];
  mapProjections: RegisteredMapProjection[];
}): Map<string, Set<string>> {
  const eventTypesByProjection = new Map<string, Set<string>>();
  for (const p of params.projections) {
    eventTypesByProjection.set(
      p.projectionName,
      new Set(p.definition.eventTypes),
    );
  }
  for (const p of params.mapProjections) {
    eventTypesByProjection.set(
      p.projectionName,
      new Set(p.definition.eventTypes),
    );
  }
  return eventTypesByProjection;
}

function matchProjectionsForAggregate(params: {
  aggEventTypes: Set<string>;
  allProjectionNames: string[];
  eventTypesByProjection: Map<string, Set<string>>;
}): string[] {
  const { aggEventTypes, allProjectionNames, eventTypesByProjection } = params;
  return allProjectionNames.filter((projName) => {
    const projEventTypes = eventTypesByProjection.get(projName)!;
    for (const et of aggEventTypes) {
      if (projEventTypes.has(et)) return true;
    }
    return false;
  });
}

/** Discovery: single pass using the union of all event types (fold + map). */
async function discoverOptimizedAggregateMap(params: {
  ctx: ReplayContext;
  discoveryTargets: Array<string | undefined>;
  allEventTypesForDiscovery: Set<string>;
  since: string;
  allProjectionNames: string[];
  eventTypesByProjection: Map<string, Set<string>>;
}): Promise<Map<string, OptimizedAggregateEntry>> {
  const {
    ctx,
    discoveryTargets,
    allEventTypesForDiscovery,
    since,
    allProjectionNames,
    eventTypesByProjection,
  } = params;
  const aggregateProjectionMap = new Map<string, OptimizedAggregateEntry>();

  for (const tenantId of discoveryTargets) {
    const client = await ctx.resolveClient(tenantId ?? "default");
    const aggregates = await discoverAffectedAggregates({
      client,
      eventTypes: [...allEventTypesForDiscovery],
      sinceMs: new Date(since).getTime(),
      tenantId,
    });
    for (const agg of aggregates) {
      const key = aggregateKey(agg);
      if (aggregateProjectionMap.has(key)) continue;
      const matchedProjections = matchProjectionsForAggregate({
        aggEventTypes: new Set(agg.eventTypes),
        allProjectionNames,
        eventTypesByProjection,
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

  return aggregateProjectionMap;
}

/** Scoped replay: keep only the requested aggregate IDs (no-op for full replay). */
function filterAggregateMapByIds(params: {
  aggregateProjectionMap: Map<string, OptimizedAggregateEntry>;
  aggregateIds?: string[];
}): void {
  const { aggregateProjectionMap, aggregateIds } = params;
  if (!aggregateIds || aggregateIds.length === 0) return;
  const allowedIds = new Set(aggregateIds);
  for (const [key, entry] of aggregateProjectionMap) {
    if (!allowedIds.has(entry.aggregateId)) {
      aggregateProjectionMap.delete(key);
    }
  }
}

async function fetchCompletedSets(params: {
  ctx: ReplayContext;
  projections: RegisteredFoldProjection[];
  mapProjections: RegisteredMapProjection[];
}): Promise<Map<string, Set<string>>> {
  const { ctx, projections, mapProjections } = params;
  const completedSets = new Map<string, Set<string>>();
  for (const p of [...projections, ...mapProjections]) {
    const completed = await getCompletedSet({
      redis: ctx.redis,
      projectionName: p.projectionName,
    });
    completedSets.set(p.projectionName, completed);
  }
  return completedSets;
}

/** Filters out aggregates completed for ALL their relevant projections. */
function partitionRemainingAggregates(params: {
  allAggregateKeys: string[];
  aggregateProjectionMap: Map<string, OptimizedAggregateEntry>;
  completedSets: Map<string, Set<string>>;
}): { remaining: string[]; skippedCount: number } {
  const { allAggregateKeys, aggregateProjectionMap, completedSets } = params;
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

  return { remaining, skippedCount };
}

function buildOptimizedBatchProgress(params: {
  allProjectionNames: string[];
  runProjectionKind: ProjectionKind;
  allAggregateKeysCount: number;
  runTenantCount: number;
  batchNum: number;
  totalBatches: number;
  batchKeysLength: number;
  acc: OptimizedReplayAccumulator;
  skippedCount: number;
  startTime: number;
}): ReplayProgress {
  const {
    allProjectionNames,
    runProjectionKind,
    allAggregateKeysCount,
    runTenantCount,
    batchNum,
    totalBatches,
    batchKeysLength,
    acc,
    skippedCount,
    startTime,
  } = params;
  return {
    phase: "replaying",
    currentProjectionName: allProjectionNames.join("+"),
    currentProjectionKind: runProjectionKind,
    currentProjectionIndex: 0,
    totalProjections: allProjectionNames.length,
    totalAggregates: allAggregateKeysCount,
    tenantCount: runTenantCount,
    currentBatch: batchNum,
    totalBatches,
    batchAggregates: batchKeysLength,
    batchPhase: "pause",
    batchEventsProcessed: 0,
    aggregatesCompleted: acc.aggregatesCompleted,
    totalEventsReplayed: acc.totalEventsReplayed,
    elapsedSec: (Date.now() - startTime) / 1000,
    skippedCount,
    batchErrors: acc.totalBatchErrors,
    firstError: acc.firstError,
  };
}

/**
 * Pause only for this batch's window. The pause loop lives INSIDE the
 * caller's try/finally so a mid-loop pauseProjection failure still unpauses
 * whatever was already paused (unpauseProjection is an idempotent SREM, so
 * unpausing never-paused projections is safe).
 */
async function pauseOptimizedBatchProjections(params: {
  ctx: ReplayContext;
  allProjectionsToPause: Array<
    RegisteredFoldProjection | RegisteredMapProjection
  >;
  allProjectionNames: string[];
  batchNum: number;
  log: ReplayLogWriter;
}): Promise<void> {
  const { ctx, allProjectionsToPause, allProjectionNames, batchNum, log } =
    params;
  for (const p of allProjectionsToPause) {
    await pauseProjection({ redis: ctx.redis, pauseKey: p.pauseKey });
  }
  log.write({
    step: "pause-batch",
    batch: batchNum,
    projections: allProjectionNames,
  });
}

/** Drain only THIS batch's aggregates — not every discovered aggregate. */
async function drainOptimizedBatchAggregates(params: {
  ctx: ReplayContext;
  batchAggregates: DiscoveredAggregate[];
  pausedProjectionEntries: Array<{
    projectionName: string;
    kind: ProjectionKind;
  }>;
  batchNum: number;
  log: ReplayLogWriter;
}): Promise<void> {
  const { ctx, batchAggregates, pausedProjectionEntries, batchNum, log } =
    params;
  await waitForAllActiveJobs({
    redis: ctx.redis,
    aggregates: batchAggregates,
    projections: pausedProjectionEntries,
  });
  log.write({
    step: "drain-batch",
    batch: batchNum,
    aggregateCount: batchAggregates.length,
  });
}

/** Unpause after EVERY batch — including a failed one — so a failed batch can never leave live processing frozen. */
async function unpauseOptimizedBatchProjections(params: {
  ctx: ReplayContext;
  allProjectionsToPause: Array<
    RegisteredFoldProjection | RegisteredMapProjection
  >;
  allProjectionNames: string[];
  batchNum: number;
  log: ReplayLogWriter;
}): Promise<void> {
  const { ctx, allProjectionsToPause, allProjectionNames, batchNum, log } =
    params;
  for (const p of allProjectionsToPause) {
    await unpauseProjection({
      redis: ctx.redis,
      pauseKey: p.pauseKey,
    }).catch((unpauseError) => {
      // Log but don't rethrow: unpausing the remaining projections (and
      // the batch's own error handling) must still proceed.
      log.write({
        step: "error",
        batch: batchNum,
        error: `unpause failed: ${
          unpauseError instanceof Error
            ? unpauseError.message
            : String(unpauseError)
        }`,
      });
    });
  }
  log.write({
    step: "unpause-batch",
    batch: batchNum,
    projections: allProjectionNames,
  });
}

/**
 * Records a batch failure: clears its markers, reports progress, and returns
 * the early-return payload the caller must return immediately — mirroring
 * the original inline `return` on the first batch error. The caller's
 * `finally` still unpauses regardless of this returning.
 */
async function recordOptimizedBatchFailure(params: {
  ctx: ReplayContext;
  error: unknown;
  batchNum: number;
  allProjectionNames: string[];
  batchKeys: string[];
  log: ReplayLogWriter;
  acc: OptimizedReplayAccumulator;
  skippedCount: number;
  progress: ReplayProgress;
  emit: () => void;
}): Promise<ReplayResult> {
  const {
    ctx,
    error,
    batchNum,
    allProjectionNames,
    batchKeys,
    log,
    acc,
    skippedCount,
    progress,
    emit,
  } = params;

  acc.totalBatchErrors++;
  const errorMsg = error instanceof Error ? error.message : String(error);
  if (!acc.firstError) acc.firstError = errorMsg;
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

  progress.batchErrors = acc.totalBatchErrors;
  progress.firstError = acc.firstError;
  emit();

  return {
    aggregatesReplayed: acc.aggregatesCompleted - skippedCount,
    totalEvents: acc.totalEventsReplayed,
    batchErrors: acc.totalBatchErrors,
    firstError: acc.firstError,
  };
}

interface ProcessOptimizedBatchParams {
  ctx: ReplayContext;
  batchKeys: string[];
  batchNum: number;
  totalBatches: number;
  aggregateProjectionMap: Map<string, OptimizedAggregateEntry>;
  projectionByName: Map<string, RegisteredFoldProjection>;
  mapProjectionByName: Map<string, RegisteredMapProjection>;
  allProjectionsToPause: Array<
    RegisteredFoldProjection | RegisteredMapProjection
  >;
  pausedProjectionEntries: Array<{
    projectionName: string;
    kind: ProjectionKind;
  }>;
  allProjectionNames: string[];
  runProjectionKind: ProjectionKind;
  allAggregateKeysCount: number;
  runTenantCount: number;
  concurrency: number;
  skippedCount: number;
  startTime: number;
  log: ReplayLogWriter;
  callbacks?: ReplayCallbacks & { log?: ReplayLogWriter };
  acc: OptimizedReplayAccumulator;
}

/**
 * Runs one optimized batch's pause/drain/mark/cutoff/replay/write/unmark
 * cycle and its progress reporting, mutating `acc` in place. Returns the
 * early-return payload when the batch fails — the caller must stop
 * processing further batches and return it immediately, exactly mirroring
 * the original inline `return` on the first batch error.
 */
async function runOptimizedBatchAttempt(params: {
  ctx: ReplayContext;
  batchKeys: string[];
  batchAggregates: DiscoveredAggregate[];
  aggregateProjectionMap: Map<string, OptimizedAggregateEntry>;
  projectionByName: Map<string, RegisteredFoldProjection>;
  mapProjectionByName: Map<string, RegisteredMapProjection>;
  allProjectionsToPause: Array<
    RegisteredFoldProjection | RegisteredMapProjection
  >;
  pausedProjectionEntries: Array<{
    projectionName: string;
    kind: ProjectionKind;
  }>;
  allProjectionNames: string[];
  batchNum: number;
  concurrency: number;
  acc: OptimizedReplayAccumulator;
  log: ReplayLogWriter;
  progress: ReplayProgress;
  emit: () => void;
}): Promise<{ eventsReplayed: number }> {
  const {
    ctx,
    batchKeys,
    batchAggregates,
    aggregateProjectionMap,
    projectionByName,
    mapProjectionByName,
    allProjectionsToPause,
    pausedProjectionEntries,
    allProjectionNames,
    batchNum,
    concurrency,
    acc,
    log,
    progress,
    emit,
  } = params;

  await pauseOptimizedBatchProjections({
    ctx,
    allProjectionsToPause,
    allProjectionNames,
    batchNum,
    log,
  });

  progress.batchPhase = "drain";
  emit();
  await drainOptimizedBatchAggregates({
    ctx,
    batchAggregates,
    pausedProjectionEntries,
    batchNum,
    log,
  });

  return await replayBatchOptimized({
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
        progress.totalEventsReplayed =
          acc.totalEventsReplayed + eventsProcessed;
      }
      emit();
    },
  });
}

function recordOptimizedBatchSuccess(params: {
  batchResult: { eventsReplayed: number };
  batchKeys: string[];
  aggregateProjectionMap: Map<string, OptimizedAggregateEntry>;
  acc: OptimizedReplayAccumulator;
  allProjectionNames: string[];
  runProjectionKind: ProjectionKind;
  batchNum: number;
  totalBatches: number;
  batchStartTime: number;
  callbacks?: ReplayCallbacks & { log?: ReplayLogWriter };
}): void {
  const {
    batchResult,
    batchKeys,
    aggregateProjectionMap,
    acc,
    allProjectionNames,
    runProjectionKind,
    batchNum,
    totalBatches,
    batchStartTime,
    callbacks,
  } = params;

  acc.totalEventsReplayed += batchResult.eventsReplayed;
  acc.aggregatesCompleted += batchKeys.length;

  for (const key of batchKeys) {
    const entry = aggregateProjectionMap.get(key)!;
    acc.touchedTenants.add(entry.tenantId);
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

function buildOptimizedBatchAggregates(
  batchKeys: string[],
  aggregateProjectionMap: Map<string, OptimizedAggregateEntry>,
): DiscoveredAggregate[] {
  return batchKeys.map((key) => {
    const entry = aggregateProjectionMap.get(key)!;
    return {
      tenantId: entry.tenantId,
      aggregateType: entry.aggregateType,
      aggregateId: entry.aggregateId,
    };
  });
}

async function processOptimizedBatch(
  params: ProcessOptimizedBatchParams,
): Promise<ReplayResult | null> {
  const batchStartTime = Date.now();
  const batchAggregates = buildOptimizedBatchAggregates(
    params.batchKeys,
    params.aggregateProjectionMap,
  );

  const progress = buildOptimizedBatchProgress({
    ...params,
    batchKeysLength: params.batchKeys.length,
  });

  const emit = () => {
    progress.elapsedSec = (Date.now() - params.startTime) / 1000;
    params.callbacks?.onProgress?.({ ...progress });
  };

  emit();

  let batchResult: { eventsReplayed: number };
  try {
    batchResult = await runOptimizedBatchAttempt({
      ...params,
      batchAggregates,
      progress,
      emit,
    });
  } catch (error) {
    return await recordOptimizedBatchFailure({
      ...params,
      error,
      progress,
      emit,
    });
  } finally {
    await unpauseOptimizedBatchProjections(params);
  }

  recordOptimizedBatchSuccess({ ...params, batchResult, batchStartTime });

  return null;
}

/**
 * Runs every batch in order, stopping and returning the early-return payload
 * the moment any batch fails — mirroring the original loop's early `return`.
 */
async function runOptimizedBatches(
  params: Omit<
    ProcessOptimizedBatchParams,
    "batchKeys" | "batchNum" | "totalBatches"
  > & {
    remaining: string[];
    aggregateBatchSize: number;
  },
): Promise<ReplayResult | null> {
  const { remaining, aggregateBatchSize } = params;
  const totalBatches = Math.ceil(remaining.length / aggregateBatchSize);

  for (let i = 0; i < remaining.length; i += aggregateBatchSize) {
    const batchKeys = remaining.slice(i, i + aggregateBatchSize);
    const batchNum = Math.floor(i / aggregateBatchSize) + 1;

    const earlyReturn = await processOptimizedBatch({
      ...params,
      batchKeys,
      batchNum,
      totalBatches,
    });
    if (earlyReturn) return earlyReturn;
  }

  return null;
}

function collectOptimizedTouchedTables(params: {
  config: ReplayConfig;
  mapProjections: RegisteredMapProjection[];
}): Set<string> {
  const { config, mapProjections } = params;
  const tables = new Set<string>();
  for (const p of config.projections) {
    if (p.targetTable) tables.add(p.targetTable);
  }
  for (const p of mapProjections) {
    if (p.targetTable) tables.add(p.targetTable);
  }
  return tables;
}

/** Non-fatal on failure — merge will happen eventually. */
async function optimizeTablesForOptimizedTenant(params: {
  ctx: ReplayContext;
  tenantId: string;
  tables: Set<string>;
  log: ReplayLogWriter;
}): Promise<void> {
  const { ctx, tenantId, tables, log } = params;
  try {
    const client = await ctx.resolveClient(tenantId);
    for (const table of tables) {
      await client.command({
        query: "OPTIMIZE TABLE {table:Identifier}",
        query_params: { table },
      });
      log.write({ step: "optimize", table, tenant: tenantId });
    }
  } catch {
    // Non-fatal — merge will happen eventually
  }
}

/**
 * Trigger OPTIMIZE TABLE on all CH tables that were written to. Runs per
 * tenant DB so each touched database gets the merge hint. No FINAL — just
 * nudge ReplacingMergeTree to deduplicate sooner.
 */
async function optimizeOptimizedReplayTables(params: {
  ctx: ReplayContext;
  config: ReplayConfig;
  mapProjections: RegisteredMapProjection[];
  acc: OptimizedReplayAccumulator;
  log: ReplayLogWriter;
}): Promise<void> {
  const { ctx, config, mapProjections, acc, log } = params;
  if (acc.totalEventsReplayed <= 0 || acc.totalBatchErrors !== 0) return;

  const tables = collectOptimizedTouchedTables({ config, mapProjections });
  const tenantTargets =
    acc.touchedTenants.size > 0 ? [...acc.touchedTenants] : ["default"];

  for (const tenantId of tenantTargets) {
    await optimizeTablesForOptimizedTenant({ ctx, tenantId, tables, log });
  }
}

/**
 * Optimized multi-projection replay: one discovery pass over the union of all
 * event types, then per-batch pause/drain/mark/cutoff/replay/write/unmark
 * across every relevant projection at once, loading each batch's events a
 * single time.
 */
interface OptimizedReplaySetup {
  aggregateProjectionMap: Map<string, OptimizedAggregateEntry>;
  projectionByName: Map<string, RegisteredFoldProjection>;
  mapProjectionByName: Map<string, RegisteredMapProjection>;
  allProjectionNames: string[];
  allProjectionsToPause: Array<
    RegisteredFoldProjection | RegisteredMapProjection
  >;
  pausedProjectionEntries: Array<{
    projectionName: string;
    kind: ProjectionKind;
  }>;
  runProjectionKind: ProjectionKind;
  runTenantCount: number;
  allAggregateKeysCount: number;
  remaining: string[];
  skippedCount: number;
}

/**
 * Discovery + resume filtering: single pass using the union of all event
 * types (fold + map), scoped by aggregateIds, then filtered against each
 * projection's completed set. Returns null when there is nothing to replay
 * (no matching aggregates, a dry run, or everything already completed) —
 * the caller returns the zero-result `ReplayResult` for all three, since
 * they're identical.
 */
function buildProjectionLookups(params: {
  projections: RegisteredFoldProjection[];
  mapProjections: RegisteredMapProjection[];
}): {
  projectionByName: Map<string, RegisteredFoldProjection>;
  mapProjectionByName: Map<string, RegisteredMapProjection>;
} {
  const projectionByName = new Map<string, RegisteredFoldProjection>();
  for (const p of params.projections) {
    projectionByName.set(p.projectionName, p);
  }
  const mapProjectionByName = new Map<string, RegisteredMapProjection>();
  for (const p of params.mapProjections) {
    mapProjectionByName.set(p.projectionName, p);
  }
  return { projectionByName, mapProjectionByName };
}

/**
 * 2. Pause + drain happen PER BATCH inside the loop below (ADR-015: the
 * pause window is "seconds per batch", not the whole run — a full-run
 * pause froze live processing for as long as the replay took). The
 * replay marker protocol (pending/cutoff/done) keeps replayed
 * aggregates correct across the unpaused gaps between batches.
 */
function buildOptimizedPauseSetup(params: {
  projections: RegisteredFoldProjection[];
  mapProjections: RegisteredMapProjection[];
  remaining: string[];
  aggregateProjectionMap: Map<string, OptimizedAggregateEntry>;
}): {
  allProjectionsToPause: Array<
    RegisteredFoldProjection | RegisteredMapProjection
  >;
  pausedProjectionEntries: Array<{
    projectionName: string;
    kind: ProjectionKind;
  }>;
  runTenantCount: number;
} {
  const { projections, mapProjections, remaining, aggregateProjectionMap } =
    params;
  const allProjectionsToPause = [...projections, ...mapProjections];
  const pausedProjectionEntries = allProjectionsToPause.map((p) => ({
    projectionName: p.projectionName,
    kind: p.kind,
  }));
  const runTenantCount = new Set(
    remaining.map((key) => aggregateProjectionMap.get(key)!.tenantId),
  ).size;
  return { allProjectionsToPause, pausedProjectionEntries, runTenantCount };
}

/** 1. Discover: single pass using the union of all event types (fold + map), scoped by aggregateIds. */
async function discoverOptimizedAggregates(params: {
  ctx: ReplayContext;
  config: ReplayConfig;
  mapProjections: RegisteredMapProjection[];
}): Promise<{
  aggregateProjectionMap: Map<string, OptimizedAggregateEntry>;
  allProjectionNames: string[];
}> {
  const { ctx, config, mapProjections } = params;
  const allEventTypesForDiscovery = collectAllEventTypesForDiscovery({
    projections: config.projections,
    mapProjections,
  });

  const allProjectionNames = [
    ...config.projections.map((p) => p.projectionName),
    ...mapProjections.map((p) => p.projectionName),
  ];

  const eventTypesByProjection = buildEventTypesByProjection({
    projections: config.projections,
    mapProjections,
  });

  const discoveryTargets =
    config.tenantIds.length > 0 ? config.tenantIds : [undefined];
  const aggregateProjectionMap = await discoverOptimizedAggregateMap({
    ctx,
    discoveryTargets,
    allEventTypesForDiscovery,
    since: config.since,
    allProjectionNames,
    eventTypesByProjection,
  });

  filterAggregateMapByIds({
    aggregateProjectionMap,
    aggregateIds: config.aggregateIds,
  });

  return { aggregateProjectionMap, allProjectionNames };
}

async function setupOptimizedReplay(params: {
  ctx: ReplayContext;
  config: ReplayConfig;
}): Promise<OptimizedReplaySetup | null> {
  const { ctx, config } = params;
  const mapProjections = config.mapProjections ?? [];

  // Progress/batch reporting kind: "map" for map-only runs, otherwise
  // "fold" (fold-only and mixed runs — fold is the dominant kind).
  const runProjectionKind: ProjectionKind =
    config.projections.length === 0 && mapProjections.length > 0
      ? "map"
      : "fold";

  const { aggregateProjectionMap, allProjectionNames } =
    await discoverOptimizedAggregates({ ctx, config, mapProjections });

  if (aggregateProjectionMap.size === 0 || config.dryRun) {
    return null;
  }

  const { projectionByName, mapProjectionByName } = buildProjectionLookups({
    projections: config.projections,
    mapProjections,
  });

  // Get completed sets for all projections (fold + map)
  const completedSets = await fetchCompletedSets({
    ctx,
    projections: config.projections,
    mapProjections,
  });

  // Filter out aggregates completed for ALL their relevant projections
  const allAggregateKeys = [...aggregateProjectionMap.keys()];
  const { remaining, skippedCount } = partitionRemainingAggregates({
    allAggregateKeys,
    aggregateProjectionMap,
    completedSets,
  });

  if (remaining.length === 0) {
    return null;
  }

  const { allProjectionsToPause, pausedProjectionEntries, runTenantCount } =
    buildOptimizedPauseSetup({
      projections: config.projections,
      mapProjections,
      remaining,
      aggregateProjectionMap,
    });

  return {
    aggregateProjectionMap,
    projectionByName,
    mapProjectionByName,
    allProjectionNames,
    allProjectionsToPause,
    pausedProjectionEntries,
    runProjectionKind,
    runTenantCount,
    allAggregateKeysCount: allAggregateKeys.length,
    remaining,
    skippedCount,
  };
}

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
  assertNoStateProjections(config);

  const log = callbacks?.log ?? nullLog;
  const aggregateBatchSize = config.aggregateBatchSize ?? 1000;
  const concurrency = config.concurrency ?? 10;
  const startTime = Date.now();
  const mapProjections = config.mapProjections ?? [];

  const setup = await setupOptimizedReplay({ ctx, config });
  if (!setup) {
    return { aggregatesReplayed: 0, totalEvents: 0, batchErrors: 0 };
  }

  const acc: OptimizedReplayAccumulator = {
    totalEventsReplayed: 0,
    totalBatchErrors: 0,
    firstError: undefined,
    aggregatesCompleted: setup.skippedCount,
    touchedTenants: new Set<string>(),
  };

  const earlyReturn = await runOptimizedBatches({
    ctx,
    remaining: setup.remaining,
    aggregateBatchSize,
    aggregateProjectionMap: setup.aggregateProjectionMap,
    projectionByName: setup.projectionByName,
    mapProjectionByName: setup.mapProjectionByName,
    allProjectionsToPause: setup.allProjectionsToPause,
    pausedProjectionEntries: setup.pausedProjectionEntries,
    allProjectionNames: setup.allProjectionNames,
    runProjectionKind: setup.runProjectionKind,
    allAggregateKeysCount: setup.allAggregateKeysCount,
    runTenantCount: setup.runTenantCount,
    concurrency,
    skippedCount: setup.skippedCount,
    startTime,
    log,
    callbacks,
    acc,
  });
  if (earlyReturn) return earlyReturn;

  // 3. Cleanup markers for all projections
  for (const name of setup.allProjectionNames) {
    await cleanupAll({ redis: ctx.redis, projectionName: name });
  }

  // 4. Trigger OPTIMIZE TABLE on touched CH tables
  await optimizeOptimizedReplayTables({
    ctx,
    config,
    mapProjections,
    acc,
    log,
  });

  return {
    aggregatesReplayed: acc.aggregatesCompleted - setup.skippedCount,
    totalEvents: acc.totalEventsReplayed,
    batchErrors: acc.totalBatchErrors,
    firstError: acc.firstError,
  };
}

/** One batch aggregate grouped by tenant, carrying its matching projections. */
interface OptimizedBatchEntry {
  key: string;
  aggregateId: string;
  aggregateType: string;
  projections: string[];
}

/**
 * Groups aggregate keys per projection — each aggregate only carries the
 * projections whose event types occur on it, so markers must be written per
 * (projection, matching aggregates) rather than the full cross product.
 */
function groupAggKeysByProjection(
  batchKeys: string[],
  aggregateProjectionMap: Map<string, OptimizedAggregateEntry>,
): Map<string, string[]> {
  const aggKeysByProjection = new Map<string, string[]>();
  for (const key of batchKeys) {
    const entry = aggregateProjectionMap.get(key)!;
    for (const projName of entry.projections) {
      const list = aggKeysByProjection.get(projName);
      if (list) {
        list.push(key);
      } else {
        aggKeysByProjection.set(projName, [key]);
      }
    }
  }
  return aggKeysByProjection;
}

function groupBatchKeysByTenant(
  batchKeys: string[],
  aggregateProjectionMap: Map<string, OptimizedAggregateEntry>,
): Map<string, OptimizedBatchEntry[]> {
  const byTenant = new Map<string, OptimizedBatchEntry[]>();
  for (const key of batchKeys) {
    const entry = aggregateProjectionMap.get(key)!;
    const batchEntry: OptimizedBatchEntry = {
      key,
      aggregateId: entry.aggregateId,
      aggregateType: entry.aggregateType,
      projections: entry.projections,
    };
    const list = byTenant.get(entry.tenantId);
    if (list) {
      list.push(batchEntry);
    } else {
      byTenant.set(entry.tenantId, [batchEntry]);
    }
  }
  return byTenant;
}

function addProjectionEventTypes(params: {
  projName: string;
  projectionByName: Map<string, RegisteredFoldProjection>;
  mapProjectionByName: Map<string, RegisteredMapProjection>;
  allEventTypes: Set<string>;
}): void {
  const { projName, projectionByName, mapProjectionByName, allEventTypes } =
    params;
  const foldProj = projectionByName.get(projName);
  if (foldProj) {
    for (const et of foldProj.definition.eventTypes) allEventTypes.add(et);
  }
  const mapProj = mapProjectionByName.get(projName);
  if (mapProj) {
    for (const et of mapProj.definition.eventTypes) allEventTypes.add(et);
  }
}

/** Collects ALL event types across the given projections (fold + map) for cutoff queries. */
function collectEventTypesForProjections(params: {
  projNames: string[];
  projectionByName: Map<string, RegisteredFoldProjection>;
  mapProjectionByName: Map<string, RegisteredMapProjection>;
}): Set<string> {
  const { projNames, projectionByName, mapProjectionByName } = params;
  const allEventTypes = new Set<string>();
  for (const projName of projNames) {
    addProjectionEventTypes({
      projName,
      projectionByName,
      mapProjectionByName,
      allEventTypes,
    });
  }
  return allEventTypes;
}

async function markOptimizedBatchPending(params: {
  redis: ReplayContext["redis"];
  aggKeysByProjection: Map<string, string[]>;
  batchKeysLength: number;
  log: ReplayLogWriter;
}): Promise<void> {
  const { redis, aggKeysByProjection, batchKeysLength, log } = params;
  for (const [projName, projAggKeys] of aggKeysByProjection) {
    await markPendingBatch({
      redis,
      projectionName: projName,
      aggKeys: projAggKeys,
    });
  }
  log.write({
    step: "mark-batch-multi",
    count: batchKeysLength,
    projections: [...aggKeysByProjection.keys()],
  });
}

/**
 * Per-tenant queries are independent — run them in parallel instead of
 * serially awaiting one tenant at a time. Each tenant first computes its
 * occurred-at bounds (cheap, key-column-only) so the cutoff and load
 * queries can prune event_log's weekly partitions; see
 * getAggregateOccurredAtBounds for the safety argument.
 */
async function computeOptimizedCutoffs(params: {
  ctx: ReplayContext;
  byTenant: Map<string, OptimizedBatchEntry[]>;
  allEventTypes: Set<string>;
  concurrency: number;
}): Promise<{
  allCutoffs: Map<string, CutoffInfo>;
  boundsByTenant: Map<string, OccurredAtBounds>;
}> {
  const { ctx, byTenant, allEventTypes, concurrency } = params;
  const allCutoffs = new Map<string, CutoffInfo>();
  const boundsByTenant = new Map<string, OccurredAtBounds>();
  await pMapLimited({
    items: [...byTenant.entries()],
    fn: async ([tenantId, entries]) => {
      const client = await ctx.resolveClient(tenantId);
      const { cutoffs: tenantCutoffs, occurredAtBounds } =
        await getBoundedCutoffs({
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
  });
  return { allCutoffs, boundsByTenant };
}

function splitByCutoffPresence(params: {
  batchKeys: string[];
  allCutoffs: Map<string, CutoffInfo>;
}): { withCutoffKeys: string[]; withoutCutoffKeys: string[] } {
  const { batchKeys, allCutoffs } = params;
  const withCutoffKeys: string[] = [];
  const withoutCutoffKeys: string[] = [];
  for (const key of batchKeys) {
    if (allCutoffs.has(key)) {
      withCutoffKeys.push(key);
    } else {
      withoutCutoffKeys.push(key);
    }
  }
  return { withCutoffKeys, withoutCutoffKeys };
}

async function unmarkOptimizedWithoutCutoff(params: {
  redis: ReplayContext["redis"];
  aggKeysByProjection: Map<string, string[]>;
  withoutCutoffKeys: string[];
}): Promise<void> {
  const { redis, aggKeysByProjection, withoutCutoffKeys } = params;
  if (withoutCutoffKeys.length === 0) return;
  const withoutCutoffSet = new Set(withoutCutoffKeys);
  for (const [projName, projAggKeys] of aggKeysByProjection) {
    await unmarkBatch({
      redis,
      projectionName: projName,
      aggKeys: projAggKeys.filter((k) => withoutCutoffSet.has(k)),
    });
  }
}

async function markOptimizedCutoffBatch(params: {
  redis: ReplayContext["redis"];
  aggKeysByProjection: Map<string, string[]>;
  allCutoffs: Map<string, CutoffInfo>;
}): Promise<void> {
  const { redis, aggKeysByProjection, allCutoffs } = params;
  for (const [projName, projAggKeys] of aggKeysByProjection) {
    const projCutoffs = new Map<string, CutoffInfo>();
    for (const key of projAggKeys) {
      const cutoff = allCutoffs.get(key);
      if (cutoff) projCutoffs.set(key, cutoff);
    }
    await markCutoffBatch({
      redis,
      projectionName: projName,
      cutoffs: projCutoffs,
    });
  }
}

/** Creates one accumulator per projection (fold or map). */
function buildOptimizedAccumulators(params: {
  ctx: ReplayContext;
  projNames: string[];
  projectionByName: Map<string, RegisteredFoldProjection>;
  mapProjectionByName: Map<string, RegisteredMapProjection>;
}): {
  foldAccumulators: Map<string, FoldAccumulator>;
  mapAccumulators: Map<string, MapAccumulator>;
} {
  const { ctx, projNames, projectionByName, mapProjectionByName } = params;
  const foldAccumulators = new Map<string, FoldAccumulator>();
  const mapAccumulators = new Map<string, MapAccumulator>();
  for (const projName of projNames) {
    const foldProj = projectionByName.get(projName);
    if (foldProj) {
      foldAccumulators.set(
        projName,
        new FoldAccumulator(foldProj.definition, ctx.accumulatorOpts),
      );
    }
    const mapProj = mapProjectionByName.get(projName);
    if (mapProj) {
      mapAccumulators.set(
        projName,
        new MapAccumulator(mapProj.definition, ctx.accumulatorOpts),
      );
    }
  }
  return { foldAccumulators, mapAccumulators };
}

/** Loads events grouped by tenant (one CH query per tenant, in parallel). */
async function loadOptimizedBatchEvents(params: {
  ctx: ReplayContext;
  byTenant: Map<string, OptimizedBatchEntry[]>;
  allCutoffs: Map<string, CutoffInfo>;
  boundsByTenant: Map<string, OccurredAtBounds>;
  concurrency: number;
}): Promise<Map<string, ReplayEvent[]>> {
  const { ctx, byTenant, allCutoffs, boundsByTenant, concurrency } = params;
  const allEvents = new Map<string, ReplayEvent[]>();

  await pMapLimited({
    items: [...byTenant.entries()],
    fn: async ([tenantId, entries]) => {
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
  });

  return allEvents;
}

/**
 * Applies one aggregate's events to every relevant fold/map projection,
 * incrementing the SHARED `counter` synchronously per event (never via
 * `counter.eventsProcessed += await ...`) — concurrent aggregates run under
 * `pMapLimited`, and a read-then-await-then-write accumulation would lose
 * concurrent increments to a stale read across the `await mapAcc.apply`
 * suspension point. Mutating the shared counter's field is safe because each
 * individual `++` is a single synchronous statement no matter how many
 * concurrent calls interleave.
 */
async function applyOptimizedAggregateEvents(params: {
  aggKey: string;
  allEvents: Map<string, ReplayEvent[]>;
  aggregateProjectionMap: Map<string, OptimizedAggregateEntry>;
  foldAccumulators: Map<string, FoldAccumulator>;
  mapAccumulators: Map<string, MapAccumulator>;
  counter: { eventsProcessed: number };
}): Promise<void> {
  const {
    aggKey,
    allEvents,
    aggregateProjectionMap,
    foldAccumulators,
    mapAccumulators,
    counter,
  } = params;
  const events = allEvents.get(aggKey) ?? [];
  const entry = aggregateProjectionMap.get(aggKey)!;

  for (const event of events) {
    for (const projName of entry.projections) {
      const foldAcc = foldAccumulators.get(projName);
      if (foldAcc) foldAcc.apply(event);

      const mapAcc = mapAccumulators.get(projName);
      if (mapAcc) await mapAcc.apply(event);
    }
    counter.eventsProcessed++;
  }
}

/** Applies all relevant projections per aggregate — with concurrency. */
async function applyOptimizedProjections(params: {
  withCutoffKeys: string[];
  allEvents: Map<string, ReplayEvent[]>;
  aggregateProjectionMap: Map<string, OptimizedAggregateEntry>;
  foldAccumulators: Map<string, FoldAccumulator>;
  mapAccumulators: Map<string, MapAccumulator>;
  concurrency: number;
  onBatchPhase: (phase: BatchPhase, eventsProcessed?: number) => void;
}): Promise<number> {
  const {
    withCutoffKeys,
    allEvents,
    aggregateProjectionMap,
    foldAccumulators,
    mapAccumulators,
    concurrency,
    onBatchPhase,
  } = params;
  const counter = { eventsProcessed: 0 };
  let aggregatesApplied = 0;
  const totalToApply = withCutoffKeys.length;

  await pMapLimited({
    items: withCutoffKeys,
    fn: async (aggKey) => {
      await applyOptimizedAggregateEvents({
        aggKey,
        allEvents,
        aggregateProjectionMap,
        foldAccumulators,
        mapAccumulators,
        counter,
      });

      // Throttled progress: emit every N aggregates plus the batch's last —
      // never once per aggregate (each emit persists status to Redis).
      aggregatesApplied++;
      if (
        aggregatesApplied % PROGRESS_EMIT_EVERY_AGGREGATES === 0 ||
        aggregatesApplied === totalToApply
      ) {
        onBatchPhase("replay", counter.eventsProcessed);
      }
    },
    concurrency,
  });

  return counter.eventsProcessed;
}

async function flushOptimizedAccumulators(params: {
  foldAccumulators: Map<string, FoldAccumulator>;
  mapAccumulators: Map<string, MapAccumulator>;
}): Promise<void> {
  const { foldAccumulators, mapAccumulators } = params;
  for (const [, acc] of foldAccumulators) {
    await acc.flush();
  }
  for (const [, acc] of mapAccumulators) {
    await acc.flush();
  }
}

/**
 * COMPLETE — terminal `done:` markers per projection (not HDEL), each
 * preserving its aggregate's cutoff boundary so a job staged but never
 * active during the pause is still skipped for events at/before the
 * cutoff after unpause. See the fold path for the full rationale.
 */
async function completeOptimizedBatch(params: {
  redis: ReplayContext["redis"];
  aggKeysByProjection: Map<string, string[]>;
  allCutoffs: Map<string, CutoffInfo>;
  withCutoffKeys: string[];
}): Promise<void> {
  const { redis, aggKeysByProjection, allCutoffs, withCutoffKeys } = params;
  const withCutoffSet = new Set(withCutoffKeys);
  for (const [projName, projAggKeys] of aggKeysByProjection) {
    const projCutoffs = new Map<string, CutoffInfo>();
    for (const key of projAggKeys) {
      if (!withCutoffSet.has(key)) continue;
      const cutoff = allCutoffs.get(key);
      if (cutoff) projCutoffs.set(key, cutoff);
    }
    await markCompletedBatch({
      redis,
      projectionName: projName,
      cutoffs: projCutoffs,
    });
  }
}

/** Phase 2: CUTOFF — get cutoffs per tenant, per aggregate. */
async function resolveOptimizedBatchCutoffs(params: {
  ctx: ReplayContext;
  batchKeys: string[];
  aggregateProjectionMap: Map<string, OptimizedAggregateEntry>;
  aggKeysByProjection: Map<string, string[]>;
  projNames: string[];
  projectionByName: Map<string, RegisteredFoldProjection>;
  mapProjectionByName: Map<string, RegisteredMapProjection>;
  concurrency: number;
  redis: ReplayContext["redis"];
}): Promise<{
  byTenant: Map<string, OptimizedBatchEntry[]>;
  allCutoffs: Map<string, CutoffInfo>;
  boundsByTenant: Map<string, OccurredAtBounds>;
  withCutoffKeys: string[];
}> {
  const {
    ctx,
    batchKeys,
    aggregateProjectionMap,
    aggKeysByProjection,
    projNames,
    projectionByName,
    mapProjectionByName,
    concurrency,
    redis,
  } = params;

  const byTenant = groupBatchKeysByTenant(batchKeys, aggregateProjectionMap);
  const allEventTypes = collectEventTypesForProjections({
    projNames,
    projectionByName,
    mapProjectionByName,
  });

  const { allCutoffs, boundsByTenant } = await computeOptimizedCutoffs({
    ctx,
    byTenant,
    allEventTypes,
    concurrency,
  });

  const { withCutoffKeys, withoutCutoffKeys } = splitByCutoffPresence({
    batchKeys,
    allCutoffs,
  });

  await unmarkOptimizedWithoutCutoff({
    redis,
    aggKeysByProjection,
    withoutCutoffKeys,
  });

  return { byTenant, allCutoffs, boundsByTenant, withCutoffKeys };
}

/** Phase 3: REPLAY — load events per tenant, apply all relevant projections. */
async function runOptimizedReplayPhase(params: {
  ctx: ReplayContext;
  projNames: string[];
  projectionByName: Map<string, RegisteredFoldProjection>;
  mapProjectionByName: Map<string, RegisteredMapProjection>;
  byTenant: Map<string, OptimizedBatchEntry[]>;
  allCutoffs: Map<string, CutoffInfo>;
  boundsByTenant: Map<string, OccurredAtBounds>;
  withCutoffKeys: string[];
  aggregateProjectionMap: Map<string, OptimizedAggregateEntry>;
  concurrency: number;
  onBatchPhase: (phase: BatchPhase, eventsProcessed?: number) => void;
}): Promise<{
  eventsProcessed: number;
  foldAccumulators: Map<string, FoldAccumulator>;
  mapAccumulators: Map<string, MapAccumulator>;
}> {
  const {
    ctx,
    projNames,
    projectionByName,
    mapProjectionByName,
    byTenant,
    allCutoffs,
    boundsByTenant,
    withCutoffKeys,
    aggregateProjectionMap,
    concurrency,
    onBatchPhase,
  } = params;

  onBatchPhase("replay", 0);

  const { foldAccumulators, mapAccumulators } = buildOptimizedAccumulators({
    ctx,
    projNames,
    projectionByName,
    mapProjectionByName,
  });

  const allEvents = await loadOptimizedBatchEvents({
    ctx,
    byTenant,
    allCutoffs,
    boundsByTenant,
    concurrency,
  });

  const eventsProcessed = await applyOptimizedProjections({
    withCutoffKeys,
    allEvents,
    aggregateProjectionMap,
    foldAccumulators,
    mapAccumulators,
    concurrency,
    onBatchPhase,
  });

  return { eventsProcessed, foldAccumulators, mapAccumulators };
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
  aggregateProjectionMap: Map<string, OptimizedAggregateEntry>;
  projectionByName: Map<string, RegisteredFoldProjection>;
  mapProjectionByName: Map<string, RegisteredMapProjection>;
  concurrency: number;
  log: ReplayLogWriter;
  onBatchPhase: (phase: BatchPhase, eventsProcessed?: number) => void;
}): Promise<{ eventsReplayed: number }> {
  const redis = ctx.redis;

  const aggKeysByProjection = groupAggKeysByProjection(
    batchKeys,
    aggregateProjectionMap,
  );
  const projNames = [...aggKeysByProjection.keys()];

  // 1. MARK each projection for its matching aggregates
  onBatchPhase("mark");
  await markOptimizedBatchPending({
    redis,
    aggKeysByProjection,
    batchKeysLength: batchKeys.length,
    log,
  });

  onBatchPhase("cutoff");
  const { byTenant, allCutoffs, boundsByTenant, withCutoffKeys } =
    await resolveOptimizedBatchCutoffs({
      ctx,
      batchKeys,
      aggregateProjectionMap,
      aggKeysByProjection,
      projNames,
      projectionByName,
      mapProjectionByName,
      concurrency,
      redis,
    });

  if (withCutoffKeys.length === 0) {
    onBatchPhase("unmark");
    return { eventsReplayed: 0 };
  }

  await markOptimizedCutoffBatch({ redis, aggKeysByProjection, allCutoffs });

  const { eventsProcessed, foldAccumulators, mapAccumulators } =
    await runOptimizedReplayPhase({
      ctx,
      projNames,
      projectionByName,
      mapProjectionByName,
      byTenant,
      allCutoffs,
      boundsByTenant,
      withCutoffKeys,
      aggregateProjectionMap,
      concurrency,
      onBatchPhase,
    });

  // 4. WRITE — flush all accumulators (fold states + map records in bulk)
  onBatchPhase("write", eventsProcessed);
  await flushOptimizedAccumulators({ foldAccumulators, mapAccumulators });

  log.write({
    step: "replay-batch-optimized",
    aggregates: withCutoffKeys.length,
    eventsProcessed,
    projections: projNames,
  });

  onBatchPhase("unmark", eventsProcessed);
  await completeOptimizedBatch({
    redis,
    aggKeysByProjection,
    allCutoffs,
    withCutoffKeys,
  });
  log.write({
    step: "unmark-batch-multi",
    count: withCutoffKeys.length,
    projections: projNames,
  });

  return { eventsReplayed: eventsProcessed };
}
