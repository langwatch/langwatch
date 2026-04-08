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
import type { CutoffInfo, DiscoveredAggregate } from "./replayEventLoader";
import { isAtOrBeforeCutoff } from "./replayConstants";
import {
  discoverAffectedAggregates,
  countEventsForAggregates,
  batchGetCutoffEventIds,
  batchLoadAggregateEvents,
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
} from "./replayMarkers";
import { pauseProjection, unpauseProjection, waitForActiveJobs } from "./replayDrain";
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
}
