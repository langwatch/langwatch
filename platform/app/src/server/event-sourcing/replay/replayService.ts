import type { ClickHouseClient } from "@clickhouse/client";
import type IORedis from "ioredis";
import type { RetentionPolicyResolver } from "../../data-retention/retentionPolicyResolver";
import { discoverProjectionAggregates } from "./replayDiscovery";
import { replayFoldProjection } from "./replayFoldPath";
import type { ReplayLogWriter } from "./replayLog";
import { nullLog } from "./replayLog";
import { replayMapProjection } from "./replayMapPath";
import { cleanupAll, hasPreviousRun } from "./replayMarkers";
import { replayOptimized } from "./replayOptimizedPath";
import { replayStateProjection } from "./replayStatePath";
import type {
  DiscoveryResult,
  RegisteredFoldProjection,
  ReplayCallbacks,
  ReplayConfig,
  ReplayContext,
  ReplayResult,
} from "./types";

/** Mutable running totals across the fold / map / state replay phases. */
interface ReplayTotals {
  aggregatesReplayed: number;
  totalEvents: number;
  batchErrors: number;
  firstError: string | undefined;
  touchedTenants: Set<string>;
}

function applyReplayPhaseResult(
  totals: ReplayTotals,
  result: ReplayResult & { touchedTenants: string[] },
): void {
  totals.aggregatesReplayed += result.aggregatesReplayed;
  totals.totalEvents += result.totalEvents;
  totals.batchErrors += result.batchErrors;
  if (!totals.firstError && result.firstError) {
    totals.firstError = result.firstError;
  }
  for (const tid of result.touchedTenants) totals.touchedTenants.add(tid);
}

export class ReplayService {
  /** Shared dependencies handed to the path implementations. */
  private readonly ctx: ReplayContext;

  constructor(deps: {
    clickhouseClientResolver: (tenantId: string) => Promise<ClickHouseClient>;
    redis: IORedis;
    /**
     * Resolves per-tenant retention so replay-rebuilt rows honour the tenant's
     * policy instead of the platform default. Optional — when absent, stores
     * fall back to PLATFORM_DEFAULT_RETENTION_DAYS, matching pre-existing
     * behaviour (and the NullReplayRepository test path).
     */
    retentionPolicyResolver?: RetentionPolicyResolver;
  }) {
    this.ctx = {
      redis: deps.redis,
      resolveClient: (tenantId?: string) =>
        deps.clickhouseClientResolver(tenantId ?? "default"),
      accumulatorOpts: { retentionResolver: deps.retentionPolicyResolver },
    };
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
    return discoverProjectionAggregates({
      resolveClient: this.ctx.resolveClient,
      eventTypes: projection.definition.eventTypes,
      since,
      tenantId,
    });
  }

  private async runFoldPhase(params: {
    config: ReplayConfig;
    totalProjections: number;
    batchSize: number;
    aggregateBatchSize: number;
    log: ReplayLogWriter;
    callbacks: (ReplayCallbacks & { log?: ReplayLogWriter }) | undefined;
    totals: ReplayTotals;
  }): Promise<void> {
    const {
      config,
      totalProjections,
      batchSize,
      aggregateBatchSize,
      log,
      callbacks,
      totals,
    } = params;
    for (let pi = 0; pi < config.projections.length; pi++) {
      const projection = config.projections[pi]!;
      const result = await replayFoldProjection({
        ctx: this.ctx,
        projection,
        projectionIndex: pi,
        totalProjections,
        tenantIds: config.tenantIds,
        aggregateIds: config.aggregateIds,
        since: config.since,
        batchSize,
        aggregateBatchSize,
        dryRun: config.dryRun ?? false,
        log,
        onProgress: callbacks?.onProgress,
        onBatchComplete: callbacks?.onBatchComplete,
      });
      applyReplayPhaseResult(totals, result);
      if (result.batchErrors > 0) break;
    }
  }

  private async runMapPhase(params: {
    config: ReplayConfig;
    mapProjections: NonNullable<ReplayConfig["mapProjections"]>;
    totalProjections: number;
    batchSize: number;
    aggregateBatchSize: number;
    log: ReplayLogWriter;
    callbacks: (ReplayCallbacks & { log?: ReplayLogWriter }) | undefined;
    totals: ReplayTotals;
  }): Promise<void> {
    const {
      config,
      mapProjections,
      totalProjections,
      batchSize,
      aggregateBatchSize,
      log,
      callbacks,
      totals,
    } = params;
    if (totals.batchErrors !== 0) return;
    for (let mi = 0; mi < mapProjections.length; mi++) {
      const projection = mapProjections[mi]!;
      const result = await replayMapProjection({
        ctx: this.ctx,
        projection,
        projectionIndex: config.projections.length + mi,
        totalProjections,
        tenantIds: config.tenantIds,
        aggregateIds: config.aggregateIds,
        since: config.since,
        batchSize,
        aggregateBatchSize,
        dryRun: config.dryRun ?? false,
        log,
        onProgress: callbacks?.onProgress,
        onBatchComplete: callbacks?.onBatchComplete,
      });
      applyReplayPhaseResult(totals, result);
      if (result.batchErrors > 0) break;
    }
  }

  /**
   * State-projection lane: pause and drain each `.withProjection()` queue,
   * then rebuild its Postgres rows deterministically from canonical events.
   */
  private async runStatePhase(params: {
    config: ReplayConfig;
    mapProjections: NonNullable<ReplayConfig["mapProjections"]>;
    stateProjections: NonNullable<ReplayConfig["stateProjections"]>;
    totalProjections: number;
    batchSize: number;
    aggregateBatchSize: number;
    log: ReplayLogWriter;
    callbacks: (ReplayCallbacks & { log?: ReplayLogWriter }) | undefined;
    totals: ReplayTotals;
  }): Promise<void> {
    const {
      config,
      mapProjections,
      stateProjections,
      totalProjections,
      batchSize,
      aggregateBatchSize,
      log,
      callbacks,
      totals,
    } = params;
    if (totals.batchErrors !== 0) return;
    for (let si = 0; si < stateProjections.length; si++) {
      const projection = stateProjections[si]!;
      const result = await replayStateProjection({
        ctx: this.ctx,
        projection,
        projectionIndex: config.projections.length + mapProjections.length + si,
        totalProjections,
        tenantIds: config.tenantIds,
        aggregateIds: config.aggregateIds,
        since: config.since,
        batchSize,
        aggregateBatchSize,
        dryRun: config.dryRun ?? false,
        log,
        onProgress: callbacks?.onProgress,
        onBatchComplete: callbacks?.onBatchComplete,
      });
      applyReplayPhaseResult(totals, result);
      if (result.batchErrors > 0) break;
    }
  }

  private collectTouchedTables(params: {
    config: ReplayConfig;
    mapProjections: NonNullable<ReplayConfig["mapProjections"]>;
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
  private async optimizeTablesForTenant(params: {
    tenantId: string;
    tables: Set<string>;
    callbacks: (ReplayCallbacks & { log?: ReplayLogWriter }) | undefined;
  }): Promise<void> {
    const { tenantId, tables, callbacks } = params;
    try {
      const client = await this.ctx.resolveClient(tenantId);
      for (const table of tables) {
        await client.command({
          query: "OPTIMIZE TABLE {table:Identifier}",
          query_params: { table },
        });
        callbacks?.log?.write({ step: "optimize", table, tenant: tenantId });
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
  private async optimizeTouchedTables(params: {
    config: ReplayConfig;
    mapProjections: NonNullable<ReplayConfig["mapProjections"]>;
    callbacks: (ReplayCallbacks & { log?: ReplayLogWriter }) | undefined;
    totals: ReplayTotals;
  }): Promise<void> {
    const { config, mapProjections, callbacks, totals } = params;
    if (totals.totalEvents <= 0 || totals.batchErrors !== 0) return;

    const tables = this.collectTouchedTables({ config, mapProjections });
    const tenantTargets =
      totals.touchedTenants.size > 0 ? [...totals.touchedTenants] : ["default"];

    for (const tenantId of tenantTargets) {
      await this.optimizeTablesForTenant({ tenantId, tables, callbacks });
    }
  }

  async replay(
    config: ReplayConfig,
    callbacks?: ReplayCallbacks & { log?: ReplayLogWriter },
  ): Promise<ReplayResult> {
    const log = callbacks?.log ?? nullLog;
    const batchSize = config.batchSize ?? 5000;
    const aggregateBatchSize = config.aggregateBatchSize ?? 1000;

    const totals: ReplayTotals = {
      aggregatesReplayed: 0,
      totalEvents: 0,
      batchErrors: 0,
      firstError: undefined,
      touchedTenants: new Set<string>(),
    };

    const mapProjections = config.mapProjections ?? [];
    const stateProjections = config.stateProjections ?? [];
    const totalProjections =
      config.projections.length +
      mapProjections.length +
      stateProjections.length;

    const phaseParams = {
      config,
      totalProjections,
      batchSize,
      aggregateBatchSize,
      log,
      callbacks,
      totals,
    };
    await this.runFoldPhase(phaseParams);
    await this.runMapPhase({ ...phaseParams, mapProjections });
    await this.runStatePhase({
      ...phaseParams,
      mapProjections,
      stateProjections,
    });
    await this.optimizeTouchedTables({
      config,
      mapProjections,
      callbacks,
      totals,
    });

    return {
      aggregatesReplayed: totals.aggregatesReplayed,
      totalEvents: totals.totalEvents,
      batchErrors: totals.batchErrors,
      firstError: totals.firstError,
    };
  }

  async replayOptimized(
    config: ReplayConfig,
    callbacks?: ReplayCallbacks & { log?: ReplayLogWriter },
  ): Promise<ReplayResult> {
    return replayOptimized({ ctx: this.ctx, config, callbacks });
  }

  /**
   * Drop the projection's replay markers: the completed set and the in-flight
   * cutoff hash. Every replay path already does this when it finishes cleanly;
   * calling it before a run turns that run into a rebuild from scratch, since
   * the completed set is what makes discovery skip aggregates an earlier
   * (possibly aborted) run had finished.
   */
  async cleanup(projectionName: string): Promise<void> {
    await cleanupAll({ redis: this.ctx.redis, projectionName });
  }

  async checkPreviousRun(
    projectionName: string,
  ): Promise<{ completedCount: number; markerCount: number }> {
    return hasPreviousRun({ redis: this.ctx.redis, projectionName });
  }
}
