import type { ClickHouseClient } from "@clickhouse/client";
import type IORedis from "ioredis";
import type {
  RegisteredFoldProjection,
  ReplayProgress,
  ReplayConfig,
  ReplayCallbacks,
  ReplayResult,
  DiscoveryResult,
  BatchPhase,
  BatchCompleteInfo,
} from "./types";
import type { CutoffInfo, DiscoveredAggregate, ReplayEvent } from "./replayEventLoader";
import { isAtOrBeforeCutoff } from "./replayConstants";
import {
  discoverAffectedAggregates,
  countEventsForAggregates,
  batchGetCutoffEventIds,
  batchLoadAggregateEvents,
  loadEventsForAggregatesBulk,
} from "./replayEventLoader";
import {
  aggregateKey,
  markPendingBatch,
  markCutoffBatch,
  unmarkBatch,
  getCompletedSet,
  getCutoffMarkers,
  removeStaleMarker,
  cleanupAll,
  hasPreviousRun,
  markPendingBatchMulti,
  markCutoffBatchMulti,
  unmarkBatchMulti,
} from "./replayMarkers";
import { pauseProjection, unpauseProjection, waitForActiveJobs, waitForAllActiveJobs } from "./replayDrain";
import { FoldAccumulator } from "./replayExecutor";

/** Minimal log interface — CLI provides concrete implementation. */
export interface ReplayLogWriter {
  write(entry: Record<string, unknown>): void;
}

/** No-op log for when no logging is needed. */
const nullLog: ReplayLogWriter = { write() {} };

export class ReplayService {
  constructor(private readonly deps: {
    clickhouseClientResolver: (tenantId: string) => Promise<ClickHouseClient>;
    redis: IORedis;
  }) {}

  private async resolveClient(tenantId?: string): Promise<ClickHouseClient> {
    return this.deps.clickhouseClientResolver(tenantId ?? "default");
  }

  async discover({
    projection,
    since,
    tenantId,
  }: {
    projection: RegisteredFoldProjection;
    since: string;
    tenantId?: string;
  }): Promise<DiscoveryResult> {
    const client = await this.resolveClient(tenantId);
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

  async replay(
    config: ReplayConfig,
    callbacks?: ReplayCallbacks & { log?: ReplayLogWriter },
  ): Promise<ReplayResult> {
    const log = callbacks?.log ?? nullLog;
    const batchSize = config.batchSize ?? 5000;
    const aggregateBatchSize = config.aggregateBatchSize ?? 1000;

    let totalAggregatesReplayed = 0;
    let totalEventsReplayed = 0;
    let totalBatchErrors = 0;
    let firstError: string | undefined;
    const touchedTenants = new Set<string>();

    for (let pi = 0; pi < config.projections.length; pi++) {
      const projection = config.projections[pi]!;
      const result = await this.replayProjection({
        projection,
        projectionIndex: pi,
        totalProjections: config.projections.length,
        tenantIds: config.tenantIds,
        since: config.since,
        batchSize,
        aggregateBatchSize,
        dryRun: config.dryRun ?? false,
        log,
        onProgress: callbacks?.onProgress,
        onBatchComplete: callbacks?.onBatchComplete,
      });

      totalAggregatesReplayed += result.aggregatesReplayed;
      totalEventsReplayed += result.totalEvents;
      totalBatchErrors += result.batchErrors;
      if (!firstError && result.firstError) firstError = result.firstError;
      for (const tid of result.touchedTenants) touchedTenants.add(tid);

      if (result.batchErrors > 0) break;
    }

    // Trigger OPTIMIZE TABLE on all CH tables that were written to.
    // Runs per tenant DB so each touched database gets the merge hint.
    // No FINAL — just nudge ReplacingMergeTree to deduplicate sooner.
    if (totalEventsReplayed > 0 && totalBatchErrors === 0) {
      const tables = new Set<string>();
      for (const p of config.projections) {
        if (p.targetTable) tables.add(p.targetTable);
      }

      const tenantTargets = touchedTenants.size > 0
        ? [...touchedTenants]
        : ["default"];

      for (const tenantId of tenantTargets) {
        try {
          const client = await this.resolveClient(tenantId);
          for (const table of tables) {
            await client.command({ query: `OPTIMIZE TABLE ${table}` });
            callbacks?.log?.write({ step: "optimize", table, tenant: tenantId });
          }
        } catch {
          // Non-fatal — merge will happen eventually
        }
      }
    }

    return {
      aggregatesReplayed: totalAggregatesReplayed,
      totalEvents: totalEventsReplayed,
      batchErrors: totalBatchErrors,
      firstError,
    };
  }

  private async replayProjection({
    projection,
    projectionIndex,
    totalProjections,
    tenantIds,
    since,
    batchSize,
    aggregateBatchSize,
    dryRun,
    log,
    onProgress,
    onBatchComplete,
  }: {
    projection: RegisteredFoldProjection;
    projectionIndex: number;
    totalProjections: number;
    tenantIds: string[];
    since: string;
    batchSize: number;
    aggregateBatchSize: number;
    dryRun: boolean;
    log: ReplayLogWriter;
    onProgress?: (progress: ReplayProgress) => void;
    onBatchComplete?: (info: BatchCompleteInfo) => void;
  }): Promise<ReplayResult & { touchedTenants: string[] }> {
    const redis = this.deps.redis;
    const startTime = Date.now();

    // Discover aggregates — when tenantIds is empty, discover across ALL tenants
    let allAggregates: DiscoveredAggregate[] = [];
    const byTenant = new Map<string, DiscoveredAggregate[]>();

    const discoveryTargets = tenantIds.length > 0 ? tenantIds : [undefined];
    for (const tenantId of discoveryTargets) {
      const discovery = await this.discover({ projection, since, tenantId });
      allAggregates = allAggregates.concat(discovery.aggregates);
      for (const [tid, aggs] of discovery.byTenant) {
        const existing = byTenant.get(tid) ?? [];
        byTenant.set(tid, existing.concat(aggs));
      }
    }

    if (allAggregates.length === 0) {
      return { aggregatesReplayed: 0, totalEvents: 0, batchErrors: 0, touchedTenants: [] };
    }

    if (dryRun) {
      return { aggregatesReplayed: 0, totalEvents: 0, batchErrors: 0, touchedTenants: [] };
    }

    // Get completed set for resume support
    const completedSet = await getCompletedSet({ redis, projectionName: projection.projectionName });

    // Remove stale markers
    const staleMarkers = await getCutoffMarkers({ redis, projectionName: projection.projectionName });
    for (const aggKey of staleMarkers.keys()) {
      await removeStaleMarker({ redis, projectionName: projection.projectionName, aggKey });
    }

    let aggregatesCompleted = 0;
    let totalEventsReplayed = 0;
    let skippedCount = 0;
    let batchErrors = 0;
    let firstError: string | undefined;

    const tenants = [...byTenant.entries()];

    for (const [tenantId, tenantAggregates] of tenants) {
      const client = await this.resolveClient(tenantId);
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
          const result = await this.replayBatch({
            client,
            redis,
            projection,
            batch,
            tenantId,
            batchSize,
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

          totalEventsReplayed += result.eventsReplayed;
          aggregatesCompleted += batch.length;

          onBatchComplete?.({
            projectionName: projection.projectionName,
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

          progress.batchErrors = batchErrors;
          progress.firstError = firstError;
          emit();

          await unpauseProjection({
            redis,
            pipelineName: projection.pipelineName,
            projectionName: projection.projectionName,
          }).catch(() => {});

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
  private async replayBatch({
    client,
    redis,
    projection,
    batch,
    tenantId,
    batchSize,
    log,
    onBatchPhase,
  }: {
    client: ClickHouseClient;
    redis: IORedis;
    projection: RegisteredFoldProjection;
    batch: DiscoveredAggregate[];
    tenantId: string;
    batchSize: number;
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
    await pauseProjection({ redis, pipelineName: projection.pipelineName, projectionName });

    // 3. DRAIN
    onBatchPhase("drain");
    const drainStart = Date.now();
    await waitForActiveJobs({ redis, aggregates: batch, projectionName });
    log.write({ step: "drain-batch", tenant: tenantId, count: batch.length, durationMs: Date.now() - drainStart });

    // 4. CUTOFF
    onBatchPhase("cutoff");
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

    log.write({ step: "cutoff-batch", tenant: tenantId, count: batch.length, withEvents: withCutoffKeys.length });

    if (withoutCutoffKeys.length > 0) {
      await unmarkBatch({ redis, projectionName, aggKeys: withoutCutoffKeys });
    }

    if (withCutoffKeys.length === 0) {
      onBatchPhase("unmark");
      await unpauseProjection({ redis, pipelineName: projection.pipelineName, projectionName });
      return { eventsReplayed: 0 };
    }

    await markCutoffBatch({ redis, projectionName, cutoffs });

    // 5. REPLAY — stream events page-by-page through the fold accumulator.
    //    Only fold states (bounded by batch size) stay in memory.
    onBatchPhase("replay", 0);
    const accumulator = new FoldAccumulator(projection.definition);
    const maxCutoffEventId = [...cutoffs.values()]
      .map((c) => c.eventId)
      .reduce((a, b) => (a > b ? a : b));
    const aggregateIds = batch
      .filter((a) => cutoffs.has(aggregateKey(a)))
      .map((a) => a.aggregateId);

    let cursorEventId = "";
    const replayStart = Date.now();

    while (true) {
      const events = await batchLoadAggregateEvents({
        client,
        tenantId,
        aggregateIds,
        eventTypes: projection.definition.eventTypes,
        maxCutoffEventId,
        cursorEventId,
        batchSize,
      });

      if (events.length === 0) break;

      for (const e of events) {
        const key = aggregateKey({
          tenantId: e.tenantId,
          aggregateType: e.aggregateType,
          aggregateId: e.aggregateId,
        });
        const cutoff = cutoffs.get(key);
        if (cutoff != null && isAtOrBeforeCutoff(e.timestamp, e.id, cutoff.timestamp, cutoff.eventId)) {
          accumulator.apply(e);
          onBatchPhase("replay", accumulator.processed);
        }
      }

      const lastEvent = events[events.length - 1];
      if (lastEvent) cursorEventId = lastEvent.id;
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

    // 7. UNMARK + UNPAUSE
    onBatchPhase("unmark", totalBatchEvents);
    await unmarkBatch({ redis, projectionName, aggKeys: withCutoffKeys });
    await unpauseProjection({ redis, pipelineName: projection.pipelineName, projectionName });
    log.write({ step: "unmark-batch", tenant: tenantId, count: withCutoffKeys.length });

    return { eventsReplayed: totalBatchEvents };
  }

  async cleanup(projectionName: string): Promise<void> {
    await cleanupAll({ redis: this.deps.redis, projectionName });
  }

  async checkPreviousRun(projectionName: string): Promise<{ completedCount: number; markerCount: number }> {
    return hasPreviousRun({ redis: this.deps.redis, projectionName });
  }

  async replayOptimized(
    config: ReplayConfig,
    callbacks?: ReplayCallbacks & { log?: ReplayLogWriter },
  ): Promise<ReplayResult> {
    const log = callbacks?.log ?? nullLog;
    const aggregateBatchSize = config.aggregateBatchSize ?? 1000;
    const concurrency = config.concurrency ?? 10;

    const startTime = Date.now();
    let totalAggregatesReplayed = 0;
    let totalEventsReplayed = 0;
    let totalBatchErrors = 0;
    let firstError: string | undefined;
    const touchedTenants = new Set<string>();

    // 1. Discover: merge all projections' aggregates into a unified map
    const aggregateProjectionMap = new Map<
      string,
      { tenantId: string; aggregateId: string; aggregateType: string; projections: string[] }
    >();

    for (const projection of config.projections) {
      const discoveryTargets = config.tenantIds.length > 0 ? config.tenantIds : [undefined];
      for (const tenantId of discoveryTargets) {
        const discovery = await this.discover({ projection, since: config.since, tenantId });
        for (const agg of discovery.aggregates) {
          const key = aggregateKey(agg);
          const existing = aggregateProjectionMap.get(key);
          if (existing) {
            if (!existing.projections.includes(projection.projectionName)) {
              existing.projections.push(projection.projectionName);
            }
          } else {
            aggregateProjectionMap.set(key, {
              tenantId: agg.tenantId,
              aggregateId: agg.aggregateId,
              aggregateType: agg.aggregateType,
              projections: [projection.projectionName],
            });
          }
        }
      }
    }

    if (aggregateProjectionMap.size === 0) {
      return { aggregatesReplayed: 0, totalEvents: 0, batchErrors: 0 };
    }

    if (config.dryRun) {
      return { aggregatesReplayed: 0, totalEvents: 0, batchErrors: 0 };
    }

    // Build a lookup from projectionName to RegisteredFoldProjection
    const projectionByName = new Map<string, RegisteredFoldProjection>();
    for (const p of config.projections) {
      projectionByName.set(p.projectionName, p);
    }

    // Get completed sets for all projections (union: skip only if completed across ALL projections)
    const completedSets = new Map<string, Set<string>>();
    for (const p of config.projections) {
      const completed = await getCompletedSet({ redis: this.deps.redis, projectionName: p.projectionName });
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

    // 2. Pause ALL projections at once
    for (const p of config.projections) {
      await pauseProjection({
        redis: this.deps.redis,
        pipelineName: p.pipelineName,
        projectionName: p.projectionName,
      });
    }
    log.write({ step: "pause-all", projections: config.projections.map((p) => p.projectionName) });

    // 3. Drain ALL active jobs across all projections
    const allDiscoveredAggregates: DiscoveredAggregate[] = remaining.map((key) => {
      const entry = aggregateProjectionMap.get(key)!;
      return { tenantId: entry.tenantId, aggregateType: entry.aggregateType, aggregateId: entry.aggregateId };
    });

    await waitForAllActiveJobs({
      redis: this.deps.redis,
      aggregates: allDiscoveredAggregates,
      projections: config.projections,
    });
    log.write({ step: "drain-all", aggregateCount: allDiscoveredAggregates.length });

    // 4. Process in batches
    const totalBatches = Math.ceil(remaining.length / aggregateBatchSize);
    let aggregatesCompleted = skippedCount;

    for (let i = 0; i < remaining.length; i += aggregateBatchSize) {
      const batchKeys = remaining.slice(i, i + aggregateBatchSize);
      const batchNum = Math.floor(i / aggregateBatchSize) + 1;
      const batchStartTime = Date.now();

      const progress: ReplayProgress = {
        phase: "replaying",
        currentProjectionName: config.projections.map((p) => p.projectionName).join("+"),
        currentProjectionIndex: 0,
        totalProjections: config.projections.length,
        totalAggregates: allAggregateKeys.length,
        tenantCount: new Set(allDiscoveredAggregates.map((a) => a.tenantId)).size,
        currentBatch: batchNum,
        totalBatches,
        batchAggregates: batchKeys.length,
        batchPhase: "mark",
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

      try {
        const batchResult = await this.replayBatchOptimized({
          batchKeys,
          aggregateProjectionMap,
          projectionByName,
          aggregateBatchSize,
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

        totalEventsReplayed += batchResult.eventsReplayed;
        aggregatesCompleted += batchKeys.length;

        for (const key of batchKeys) {
          const entry = aggregateProjectionMap.get(key)!;
          touchedTenants.add(entry.tenantId);
        }

        callbacks?.onBatchComplete?.({
          projectionName: config.projections.map((p) => p.projectionName).join("+"),
          batchNum,
          totalBatches,
          aggregatesInBatch: batchKeys.length,
          eventsInBatch: batchResult.eventsReplayed,
          durationSec: (Date.now() - batchStartTime) / 1000,
        });
      } catch (error) {
        totalBatchErrors++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (!firstError) firstError = errorMsg;
        log.write({ step: "error", batch: batchNum, error: errorMsg });

        progress.batchErrors = totalBatchErrors;
        progress.firstError = firstError;
        emit();

        // Unpause all projections on error
        for (const p of config.projections) {
          await unpauseProjection({
            redis: this.deps.redis,
            pipelineName: p.pipelineName,
            projectionName: p.projectionName,
          }).catch(() => {});
        }

        return {
          aggregatesReplayed: aggregatesCompleted - skippedCount,
          totalEvents: totalEventsReplayed,
          batchErrors: totalBatchErrors,
          firstError,
        };
      }
    }

    // 5. Unpause ALL projections
    for (const p of config.projections) {
      await unpauseProjection({
        redis: this.deps.redis,
        pipelineName: p.pipelineName,
        projectionName: p.projectionName,
      });
    }
    log.write({ step: "unpause-all", projections: config.projections.map((p) => p.projectionName) });

    // 6. Cleanup markers for all projections
    for (const p of config.projections) {
      await cleanupAll({ redis: this.deps.redis, projectionName: p.projectionName });
    }

    // 7. Trigger OPTIMIZE TABLE on touched CH tables
    if (totalEventsReplayed > 0 && totalBatchErrors === 0) {
      const tables = new Set<string>();
      for (const p of config.projections) {
        if (p.targetTable) tables.add(p.targetTable);
      }

      const tenantTargets = touchedTenants.size > 0 ? [...touchedTenants] : ["default"];

      for (const tenantId of tenantTargets) {
        try {
          const client = await this.resolveClient(tenantId);
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

  private async replayBatchOptimized({
    batchKeys,
    aggregateProjectionMap,
    projectionByName,
    aggregateBatchSize: _aggregateBatchSize,
    concurrency,
    log,
    onBatchPhase,
  }: {
    batchKeys: string[];
    aggregateProjectionMap: Map<
      string,
      { tenantId: string; aggregateId: string; aggregateType: string; projections: string[] }
    >;
    projectionByName: Map<string, RegisteredFoldProjection>;
    aggregateBatchSize: number;
    concurrency: number;
    log: ReplayLogWriter;
    onBatchPhase: (phase: BatchPhase, eventsProcessed?: number) => void;
  }): Promise<{ eventsReplayed: number }> {
    const redis = this.deps.redis;

    // Collect all unique projection names for this batch
    const batchProjectionNames = new Set<string>();
    for (const key of batchKeys) {
      const entry = aggregateProjectionMap.get(key)!;
      for (const projName of entry.projections) {
        batchProjectionNames.add(projName);
      }
    }
    const projNames = [...batchProjectionNames];

    // 1. MARK all projections for this batch
    onBatchPhase("mark");
    await markPendingBatchMulti({ redis, projectionNames: projNames, aggKeys: batchKeys });
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

    // Collect ALL event types across all projections for cutoff queries
    const allEventTypes = new Set<string>();
    for (const projName of projNames) {
      const proj = projectionByName.get(projName)!;
      for (const et of proj.definition.eventTypes) {
        allEventTypes.add(et);
      }
    }

    const allCutoffs = new Map<string, CutoffInfo>();
    for (const [tenantId, entries] of byTenant) {
      const client = await this.resolveClient(tenantId);
      const tenantCutoffs = await batchGetCutoffEventIds({
        client,
        tenantId,
        aggregateIds: entries.map((e) => e.aggregateId),
        eventTypes: [...allEventTypes],
      });
      for (const [k, v] of tenantCutoffs) {
        allCutoffs.set(k, v);
      }
    }

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
      await unmarkBatchMulti({ redis, projectionNames: projNames, aggKeys: withoutCutoffKeys });
    }

    if (withCutoffKeys.length === 0) {
      onBatchPhase("unmark");
      return { eventsReplayed: 0 };
    }

    await markCutoffBatchMulti({ redis, projectionNames: projNames, cutoffs: allCutoffs });

    // 3. REPLAY — load events per tenant, apply all relevant projections
    onBatchPhase("replay", 0);

    // Create one accumulator per projection
    const accumulators = new Map<string, FoldAccumulator>();
    for (const projName of projNames) {
      const proj = projectionByName.get(projName)!;
      accumulators.set(projName, new FoldAccumulator(proj.definition));
    }

    // Load events grouped by tenant (one CH query per tenant)
    const allEvents = new Map<string, ReplayEvent[]>();

    for (const [tenantId, entries] of byTenant) {
      const client = await this.resolveClient(tenantId);
      const aggIds = entries
        .filter((e) => allCutoffs.has(e.key))
        .map((e) => e.aggregateId);

      if (aggIds.length === 0) continue;

      const tenantEvents = await loadEventsForAggregatesBulk({
        client,
        tenantId,
        aggregateIds: aggIds,
        cutoffs: allCutoffs,
      });

      for (const [aggKey, events] of tenantEvents) {
        allEvents.set(aggKey, events);
      }
    }

    // Apply all relevant projections per aggregate — with concurrency
    let eventsProcessed = 0;

    await pMapLimited(withCutoffKeys, async (aggKey) => {
      const events = allEvents.get(aggKey) ?? [];
      const entry = aggregateProjectionMap.get(aggKey)!;

      for (const event of events) {
        for (const projName of entry.projections) {
          const acc = accumulators.get(projName);
          if (acc) {
            acc.apply(event);
          }
        }
        eventsProcessed++;
      }

      onBatchPhase("replay", eventsProcessed);
    }, concurrency);

    // 4. WRITE — flush all accumulators
    onBatchPhase("write", eventsProcessed);
    for (const [_projName, acc] of accumulators) {
      await acc.flush();
    }

    log.write({
      step: "replay-batch-optimized",
      aggregates: withCutoffKeys.length,
      eventsProcessed,
      projections: projNames,
    });

    // 5. UNMARK
    onBatchPhase("unmark", eventsProcessed);
    await unmarkBatchMulti({ redis, projectionNames: projNames, aggKeys: withCutoffKeys });
    log.write({ step: "unmark-batch-multi", count: withCutoffKeys.length, projections: projNames });

    return { eventsReplayed: eventsProcessed };
  }
}

async function pMapLimited<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  concurrency: number,
): Promise<void> {
  const executing = new Set<Promise<void>>();
  for (const item of items) {
    const p = fn(item).then(() => {
      executing.delete(p);
    });
    executing.add(p);
    if (executing.size >= concurrency) await Promise.race(executing);
  }
  await Promise.all(executing);
}
