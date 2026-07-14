import type { ClickHouseClient } from "@clickhouse/client";
import type IORedis from "ioredis";
import type {
  RegisteredFoldProjection,
  ReplayConfig,
  ReplayCallbacks,
  ReplayResult,
  DiscoveryResult,
  ReplayContext,
} from "./types";
import { cleanupAll, hasPreviousRun } from "./replayMarkers";
import type { ReplayLogWriter } from "./replayLog";
import { nullLog } from "./replayLog";
import { discoverProjectionAggregates } from "./replayDiscovery";
import { replayFoldProjection } from "./replayFoldPath";
import { replayMapProjection } from "./replayMapPath";
import { replayOptimized } from "./replayOptimizedPath";
import type { RetentionPolicyResolver } from "../../data-retention/retentionPolicyResolver";

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
      projection,
      since,
      tenantId,
    });
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

    const mapProjections = config.mapProjections ?? [];
    const totalProjections = config.projections.length + mapProjections.length;

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

      totalAggregatesReplayed += result.aggregatesReplayed;
      totalEventsReplayed += result.totalEvents;
      totalBatchErrors += result.batchErrors;
      if (!firstError && result.firstError) firstError = result.firstError;
      for (const tid of result.touchedTenants) touchedTenants.add(tid);

      if (result.batchErrors > 0) break;
    }

    if (totalBatchErrors === 0) {
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

        totalAggregatesReplayed += result.aggregatesReplayed;
        totalEventsReplayed += result.totalEvents;
        totalBatchErrors += result.batchErrors;
        if (!firstError && result.firstError) firstError = result.firstError;
        for (const tid of result.touchedTenants) touchedTenants.add(tid);

        if (result.batchErrors > 0) break;
      }
    }

    // Trigger OPTIMIZE TABLE on all CH tables that were written to.
    // Runs per tenant DB so each touched database gets the merge hint.
    // No FINAL — just nudge ReplacingMergeTree to deduplicate sooner.
    if (totalEventsReplayed > 0 && totalBatchErrors === 0) {
      const tables = new Set<string>();
      for (const p of config.projections) {
        if (p.targetTable) tables.add(p.targetTable);
      }
      for (const p of mapProjections) {
        if (p.targetTable) tables.add(p.targetTable);
      }

      const tenantTargets = touchedTenants.size > 0
        ? [...touchedTenants]
        : ["default"];

      for (const tenantId of tenantTargets) {
        try {
          const client = await this.ctx.resolveClient(tenantId);
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

  async replayOptimized(
    config: ReplayConfig,
    callbacks?: ReplayCallbacks & { log?: ReplayLogWriter },
  ): Promise<ReplayResult> {
    return replayOptimized({ ctx: this.ctx, config, callbacks });
  }

  async cleanup(projectionName: string): Promise<void> {
    await cleanupAll({ redis: this.ctx.redis, projectionName });
  }

  async checkPreviousRun(projectionName: string): Promise<{ completedCount: number; markerCount: number }> {
    return hasPreviousRun({ redis: this.ctx.redis, projectionName });
  }
}
