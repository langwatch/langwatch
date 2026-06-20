/**
 * Analytics Service (ADR-034 Phase 3 app-layer module).
 *
 * Public entrypoint for the analytics read API. Owns NO SQL. Orchestrates:
 *
 *   1. Feature-flag check (`release_event_sourced_analytics_read`)
 *   2. Route-table lookup (`pickAnalyticsTable`)
 *   3. Dispatch to the right repository (rollup / slim / legacy shim)
 *   4. Optional tripwire (`release_event_sourced_analytics_read_tripwire`)
 *   5. Return the routed result
 *
 * Routes call this service; this service calls repositories. The legacy
 * `~/server/analytics/analytics.service.ts` has been deleted as part of
 * this rewrite — all callers now import from `~/server/app-layer/analytics`.
 *
 * Per CLAUDE.md / project memory: services use `getX` (this file:
 * `getTimeseries`, `getFeedbacks`, `getTopUsedDocuments`); repositories use
 * `findX` / `runX` (see this module's repositories/ files).
 */

import { createHash } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { prisma as defaultPrisma } from "~/server/db";
import { featureFlagService } from "~/server/featureFlag";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { getClickHouseAnalyticsService } from "~/server/analytics/clickhouse/clickhouse-analytics.service";
import type { TimeseriesInputType } from "~/server/analytics/registry";
import type {
  AnalyticsBackend,
  FeedbacksResult,
  TimeseriesResult,
  TopDocumentsResult,
} from "~/server/analytics/types";
import type { FilterField } from "~/server/filters/types";
import { currentVsPreviousDates } from "~/server/api/routers/analytics/common";
import { TtlCache } from "~/server/utils/ttlCache";
import {
  type AnalyticsTable,
  pickAnalyticsTable,
} from "./routing/route-table";
import {
  TraceAnalyticsClickHouseReadRepository,
  type TraceAnalyticsReadRepository,
} from "./repositories/trace-analytics.clickhouse.repository";
import {
  TraceAnalyticsRollupClickHouseReadRepository,
  type TraceAnalyticsRollupReadRepository,
} from "./repositories/trace-analytics-rollup.clickhouse.repository";
import {
  EvaluationAnalyticsClickHouseReadRepository,
  type EvaluationAnalyticsReadRepository,
} from "./repositories/evaluation-analytics.clickhouse.repository";
import {
  EvaluationAnalyticsRollupClickHouseReadRepository,
  type EvaluationAnalyticsRollupReadRepository,
} from "./repositories/evaluation-analytics-rollup.clickhouse.repository";
import {
  ClickHouseLegacyTraceSummariesShim,
  type LegacyTraceSummariesShim,
} from "./repositories/legacy-trace-summaries.shim";
import {
  ClickHouseLegacyEvaluationRunsShim,
  type LegacyEvaluationRunsShim,
} from "./repositories/legacy-evaluation-runs.shim";
import { compareForTripwire } from "./tripwire/divergence-compare";

const TIMESERIES_CACHE_TTL_MS = 30_000 as const;
/** Bucket-count safety net (same as the legacy CH service). */
const MAX_TIMESERIES_BUCKETS = 1000;
const MINUTES_PER_DAY = 24 * 60;
const MS_PER_MINUTE = 1000 * 60;

export interface AnalyticsServiceDependencies {
  prisma: PrismaClient;
  rollupRepository: TraceAnalyticsRollupReadRepository;
  slimRepository: TraceAnalyticsReadRepository;
  legacyShim: LegacyTraceSummariesShim;
  /** ADR-034 Phase 6: eval analytics fast-path repositories. */
  evalRollupRepository: EvaluationAnalyticsRollupReadRepository;
  evalSlimRepository: EvaluationAnalyticsReadRepository;
  evalLegacyShim: LegacyEvaluationRunsShim;
  /**
   * Backend used for the non-routed read paths (`getFeedbacks`,
   * `getTopUsedDocuments`). Those queries have no ADR-034 routing — they
   * always hit the legacy backend. Composing in lets tests stub it out.
   */
  legacyBackend: AnalyticsBackend;
}

/**
 * Public analytics service. Exposes the three read entrypoints called from
 * the analytics tRPC + Hono routes.
 */
export class AnalyticsService {
  private readonly tracer = getLangWatchTracer(
    "langwatch.app-layer.analytics.service",
  );
  private readonly timeseriesCache = new TtlCache<TimeseriesResult>(
    TIMESERIES_CACHE_TTL_MS,
    "analytics:ts:",
  );

  constructor(private readonly deps: AnalyticsServiceDependencies) {}

  /**
   * Get timeseries analytics data (with 30s TTL cache).
   *
   * Phase 3 routing: when `release_event_sourced_analytics_read` is ON for the
   * project, `pickAnalyticsTable` picks one of trace_analytics_rollup /
   * trace_analytics / trace_summaries per query shape. When OFF (default)
   * every call hits trace_summaries — behaviour unchanged. Tripwire
   * (`release_event_sourced_analytics_read_tripwire`) runs the legacy query
   * alongside the routed query and logs divergence.
   */
  async getTimeseries(input: TimeseriesInputType): Promise<TimeseriesResult> {
    return this.tracer.withActiveSpan(
      "AnalyticsService.getTimeseries",
      { attributes: { "tenant.id": input.projectId } },
      async () => {
        const hash = createHash("sha256")
          .update(JSON.stringify(input))
          .digest("hex");
        const cacheKey = `${input.projectId}:${hash}`;
        const cached = await this.timeseriesCache.get(cacheKey);
        if (cached) return cached;

        const table = await this.resolveAnalyticsTable(input);

        // OFF (legacy) or routed → a legacy table: single call, no overhead.
        if (table === "trace_summaries") {
          const result =
            await this.deps.legacyShim.runTraceSummariesTimeseries(input);
          await this.timeseriesCache.set(cacheKey, result);
          return result;
        }
        if (table === "evaluation_runs") {
          const result =
            await this.deps.evalLegacyShim.runEvaluationRunsTimeseries(input);
          await this.timeseriesCache.set(cacheKey, result);
          return result;
        }

        const tripwireEnabled = await isTripwireEnabled(input.projectId);
        const legacyForTripwire =
          table === "evaluation_analytics_rollup" ||
          table === "evaluation_analytics"
            ? this.deps.evalLegacyShim.runEvaluationRunsTimeseries.bind(
                this.deps.evalLegacyShim,
              )
            : this.deps.legacyShim.runTraceSummariesTimeseries.bind(
                this.deps.legacyShim,
              );

        if (!tripwireEnabled) {
          const result = await this.runRouted(table, input);
          await this.timeseriesCache.set(cacheKey, result);
          return result;
        }

        // Tripwire: run both queries in parallel; log on divergence; return
        // the routed result so the flag flip behaviour is observable
        // end-to-end. The legacy comparator picks per-source so an
        // eval-routed query is compared against `evaluation_runs`, not
        // `trace_summaries`.
        const [routedResult, legacyResult] = await Promise.all([
          this.runRouted(table, input),
          legacyForTripwire(input),
        ]);
        compareForTripwire({
          projectId: input.projectId,
          table,
          routed: routedResult,
          legacy: legacyResult,
        });
        await this.timeseriesCache.set(cacheKey, routedResult);
        return routedResult;
      },
    );
  }

  async getFeedbacks(
    projectId: string,
    startDate: number,
    endDate: number,
    filters: Partial<
      Record<
        FilterField,
        | string[]
        | Record<string, string[]>
        | Record<string, Record<string, string[]>>
      >
    >,
  ): Promise<FeedbacksResult> {
    return this.tracer.withActiveSpan(
      "AnalyticsService.getFeedbacks",
      { attributes: { "tenant.id": projectId } },
      () =>
        this.deps.legacyBackend.getFeedbacks(
          projectId,
          startDate,
          endDate,
          filters,
        ),
    );
  }

  async getTopUsedDocuments(
    projectId: string,
    startDate: number,
    endDate: number,
    filters: Partial<
      Record<
        FilterField,
        | string[]
        | Record<string, string[]>
        | Record<string, Record<string, string[]>>
      >
    >,
  ): Promise<TopDocumentsResult> {
    return this.tracer.withActiveSpan(
      "AnalyticsService.getTopUsedDocuments",
      { attributes: { "tenant.id": projectId } },
      () =>
        this.deps.legacyBackend.getTopUsedDocuments(
          projectId,
          startDate,
          endDate,
          filters,
        ),
    );
  }

  /**
   * Resolve which analytics table should serve this `getTimeseries` call.
   * Flag OFF → always `"trace_summaries"` (legacy code path, unchanged).
   * Flag ON  → delegate to `pickAnalyticsTable(...)` per query shape.
   */
  private async resolveAnalyticsTable(
    input: TimeseriesInputType,
  ): Promise<AnalyticsTable> {
    const enabled = await featureFlagService.isEnabled(
      "release_event_sourced_analytics_read",
      { distinctId: input.projectId, projectId: input.projectId },
    );
    if (!enabled) return "trace_summaries";
    return pickAnalyticsTable({
      series: input.series,
      filters: input.filters,
      groupBy: input.groupBy,
    });
  }

  /**
   * Dispatch a routed call to the slim or rollup repository. Computes the
   * date envelope (start / end / previous period) + bucket-count guard the
   * same way the legacy CH service did, so the two paths produce identical
   * date math.
   */
  private async runRouted(
    table: Exclude<AnalyticsTable, "trace_summaries" | "evaluation_runs">,
    input: TimeseriesInputType,
  ): Promise<TimeseriesResult> {
    const { previousPeriodStartDate, startDate, endDate } =
      currentVsPreviousDates(
        input,
        typeof input.timeScale === "number" ? input.timeScale : undefined,
      );

    let adjustedTimeScale = input.timeScale;
    if (typeof input.timeScale === "number") {
      const totalMinutes =
        (endDate.getTime() - startDate.getTime()) / MS_PER_MINUTE;
      const estimatedBuckets = totalMinutes / input.timeScale;
      if (estimatedBuckets > MAX_TIMESERIES_BUCKETS) {
        adjustedTimeScale = MINUTES_PER_DAY;
      }
    } else if (input.timeScale === undefined) {
      adjustedTimeScale = MINUTES_PER_DAY;
    }

    const builderInput = {
      projectId: input.projectId,
      startDate,
      endDate,
      previousPeriodStartDate,
      series: input.series,
      filters: input.filters,
      groupBy: input.groupBy,
      groupByKey: input.groupByKey,
      timeScale: adjustedTimeScale,
      timeZone: input.timeZone,
    };

    if (table === "trace_analytics_rollup") {
      return this.deps.rollupRepository.runRollupTimeseries({
        tenantId: input.projectId,
        builderInput,
        series: input.series,
        groupBy: input.groupBy,
        originalTimeScale: input.timeScale,
      });
    }
    if (table === "trace_analytics") {
      return this.deps.slimRepository.runSlimTimeseries({
        tenantId: input.projectId,
        builderInput,
        series: input.series,
        groupBy: input.groupBy,
        originalTimeScale: input.timeScale,
      });
    }
    if (table === "evaluation_analytics_rollup") {
      return this.deps.evalRollupRepository.runRollupTimeseries({
        tenantId: input.projectId,
        builderInput,
        series: input.series,
        groupBy: input.groupBy,
        originalTimeScale: input.timeScale,
      });
    }
    if (table === "evaluation_analytics") {
      return this.deps.evalSlimRepository.runSlimTimeseries({
        tenantId: input.projectId,
        builderInput,
        series: input.series,
        groupBy: input.groupBy,
        originalTimeScale: input.timeScale,
      });
    }
    // Exhaustiveness check — if AnalyticsTable ever gains a new variant,
    // the compiler catches it here instead of silently routing to the
    // wrong path. "trace_summaries" and "evaluation_runs" are handled
    // earlier via the shim branches in getTimeseries, so they never reach
    // this method.
    const _exhaustive: never = table;
    throw new Error(
      `Unhandled analytics table in routed dispatch: ${String(_exhaustive)}`,
    );
  }
}

async function isTripwireEnabled(projectId: string): Promise<boolean> {
  return featureFlagService.isEnabled(
    "release_event_sourced_analytics_read_tripwire",
    { distinctId: projectId, projectId },
  );
}

/**
 * Default ClickHouse resolver — same shape as `app-layer/presets.ts`:
 * `getClickHouseClientForProject` returns `null` for "not configured"; the
 * resolver contract is "throw if no client", which lets the repository
 * `await` it without a null-check.
 */
const defaultResolveClient: ClickHouseClientResolver = async (tenantId) => {
  const client = await getClickHouseClientForProject(tenantId);
  if (!client)
    throw new Error(`ClickHouse not available for tenant ${tenantId}`);
  return client;
};

/**
 * Factory using production dependencies (real ClickHouse resolver, real
 * Prisma, legacy backend singleton).
 */
export function createAnalyticsService(
  prisma: PrismaClient = defaultPrisma,
  resolveClient: ClickHouseClientResolver = defaultResolveClient,
): AnalyticsService {
  return new AnalyticsService({
    prisma,
    rollupRepository: new TraceAnalyticsRollupClickHouseReadRepository(
      resolveClient,
    ),
    slimRepository: new TraceAnalyticsClickHouseReadRepository(resolveClient),
    legacyShim: new ClickHouseLegacyTraceSummariesShim(resolveClient),
    evalRollupRepository: new EvaluationAnalyticsRollupClickHouseReadRepository(
      resolveClient,
    ),
    evalSlimRepository: new EvaluationAnalyticsClickHouseReadRepository(
      resolveClient,
    ),
    evalLegacyShim: new ClickHouseLegacyEvaluationRunsShim(resolveClient),
    legacyBackend: getClickHouseAnalyticsService(),
  });
}

let analyticsService: AnalyticsService | null = null;

export function getAnalyticsService(prisma?: PrismaClient): AnalyticsService {
  if (!analyticsService) {
    analyticsService = createAnalyticsService(prisma);
  }
  return analyticsService;
}

export function resetAnalyticsService(): void {
  analyticsService = null;
}
