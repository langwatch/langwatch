import type { ClickHouseClient } from "@clickhouse/client";
import type IORedis from "ioredis";
import type { RetentionPolicyResolver } from "../../data-retention/retentionPolicyResolver";
import { discoverProjectionAggregates } from "./replayDiscovery";
import { runFoldMapReplay } from "./replayEngine";
import type { ReplayLogWriter } from "./replayLog";
import { nullLog } from "./replayLog";
import { cleanupAll, hasPreviousRun } from "./replayMarkers";
import { replayStateProjection } from "./replayStatePath";
import type {
  DiscoveryResult,
  RegisteredFoldProjection,
  ReplayCallbacks,
  ReplayConfig,
  ReplayContext,
  ReplayResult,
} from "./types";

interface ReplayTotals {
  aggregatesReplayed: number;
  totalEvents: number;
  batchErrors: number;
  firstError: string | undefined;
}

/** Fold one lane's result into the run's totals, keeping the first error. */
function accumulate(totals: ReplayTotals, result: ReplayResult): void {
  totals.aggregatesReplayed += result.aggregatesReplayed;
  totals.totalEvents += result.totalEvents;
  totals.batchErrors += result.batchErrors;
  if (!totals.firstError && result.firstError) {
    totals.firstError = result.firstError;
  }
}

/**
 * Orchestrates projection replays. Every run flows through ONE engine:
 *
 * - Fold and map projections replay together via {@link runFoldMapReplay} —
 *   one discovery over the union of their event types, each batch's events
 *   loaded exactly once and streamed into every relevant accumulator.
 * - Operational state projections (`.withProjection()`) rebuild afterwards in
 *   their own paused lane ({@link replayStateProjection}) — a from-init
 *   canonical rebuild keyed across aggregates, which the per-batch marker
 *   protocol does not fit.
 *
 * There is no per-projection serial path: selecting a state projection no
 * longer demotes the run's folds and maps to one-load-per-projection.
 */
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

  async replay(
    config: ReplayConfig,
    callbacks?: ReplayCallbacks & { log?: ReplayLogWriter },
  ): Promise<ReplayResult> {
    const mapProjections = config.mapProjections ?? [];
    const totals: ReplayTotals = {
      aggregatesReplayed: 0,
      totalEvents: 0,
      batchErrors: 0,
      firstError: undefined,
    };

    // Fold + map projections: the shared batch engine, one event load per
    // batch across every selected projection.
    if (config.projections.length > 0 || mapProjections.length > 0) {
      const result = await runFoldMapReplay({
        ctx: this.ctx,
        config: { ...config, stateProjections: [] },
        callbacks,
      });
      accumulate(totals, result);
    }

    if (totals.batchErrors === 0) {
      await this.replayStateLane({ config, callbacks, totals });
    }

    return {
      aggregatesReplayed: totals.aggregatesReplayed,
      totalEvents: totals.totalEvents,
      batchErrors: totals.batchErrors,
      firstError: totals.firstError,
    };
  }

  /**
   * State-projection lane: pause and drain each `.withProjection()` queue,
   * then rebuild its Postgres rows deterministically from canonical events.
   */
  private async replayStateLane({
    config,
    callbacks,
    totals,
  }: {
    config: ReplayConfig;
    callbacks?: ReplayCallbacks & { log?: ReplayLogWriter };
    totals: ReplayTotals;
  }): Promise<void> {
    const mapProjections = config.mapProjections ?? [];
    const stateProjections = config.stateProjections ?? [];
    const totalProjections =
      config.projections.length +
      mapProjections.length +
      stateProjections.length;
    const log = callbacks?.log ?? nullLog;

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
        batchSize: config.batchSize ?? 5000,
        aggregateBatchSize: config.aggregateBatchSize ?? 1000,
        dryRun: config.dryRun ?? false,
        log,
        onProgress: callbacks?.onProgress,
        onBatchComplete: callbacks?.onBatchComplete,
      });

      accumulate(totals, result);
      if (result.batchErrors > 0) return;
    }
  }

  /**
   * Run only the fold/map engine. Kept for callers that select fold and map
   * projections explicitly; throws if the config carries state projections.
   */
  async replayOptimized(
    config: ReplayConfig,
    callbacks?: ReplayCallbacks & { log?: ReplayLogWriter },
  ): Promise<ReplayResult> {
    return runFoldMapReplay({ ctx: this.ctx, config, callbacks });
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
