/**
 * Analytics Service (ADR-034 Phase 3 app-layer module).
 *
 * Public entrypoint for the analytics read API. Owns NO SQL. Orchestrates:
 *
 *   1. Route-table lookup (`pickAnalyticsTable`) — by query SHAPE
 *   2. Dispatch to the right repository (rollup / slim / legacy shim)
 *   3. Optional tripwire (`release_event_sourced_analytics_read_tripwire`)
 *   4. Return the routed result
 *
 * `release_event_sourced_analytics_read` no longer appears here. It is
 * permanently on, so gating on it spent a feature-flag round trip per query to
 * be told "yes". Routing to the legacy tables survives it — that is a property
 * of the query's shape, not of any flag (see `resolveAnalyticsTable`).
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
import { getLangWatchTracer } from "langwatch";
import type { TimeseriesInputType } from "~/server/analytics/registry";
import type {
  AnalyticsBackend,
  FeedbacksResult,
  TimeseriesResult,
  TopDocumentsResult,
} from "~/server/analytics/types";
import { currentVsPreviousDates } from "~/server/api/routers/analytics/common";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { featureFlagService } from "~/server/featureFlag";
import { NOT_TARGETED } from "~/server/featureFlag/targeting";
import type { FilterField } from "~/server/filters/types";
import { TtlCache } from "~/server/utils/ttlCache";
import { adjustTimeScaleForBucketCap } from "./query-builders/_shared";
import {
  type AnalyticsTimeseriesReadRepository,
  createEvalRollupReadRepo,
  createEvalSlimReadRepo,
  createTraceRollupReadRepo,
  createTraceSlimReadRepo,
} from "./repositories/analyticsTimeseriesRead.repository";
import {
  ClickHouseLegacyAnalyticsShim,
  type LegacyAnalyticsShim,
} from "./repositories/legacy.shim";
import { type AnalyticsTable, pickAnalyticsTable } from "./routing/route-table";
import { compareForTripwire } from "./tripwire/divergence-compare";
import type { TimeseriesReadOptions } from "./types";

const TIMESERIES_CACHE_TTL_MS = 30_000 as const;

export interface AnalyticsServiceDependencies {
  rollupRepository: AnalyticsTimeseriesReadRepository;
  slimRepository: AnalyticsTimeseriesReadRepository;
  /**
   * Legacy shim for trace_summaries + evaluation_runs. One shim (both
   * legacy tables dispatch through the same `buildTimeseriesQuery` — the
   * builder handles both source registries internally).
   */
  legacyShim: LegacyAnalyticsShim;
  /** ADR-034 Phase 6: eval analytics fast-path repositories. */
  evalRollupRepository: AnalyticsTimeseriesReadRepository;
  evalSlimRepository: AnalyticsTimeseriesReadRepository;
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
   * `pickAnalyticsTable` picks one of trace_analytics_rollup / trace_analytics
   * / trace_summaries / evaluation_runs per query shape. Tripwire
   * (`release_event_sourced_analytics_read_tripwire`) runs the legacy query
   * alongside the routed query and logs divergence.
   *
   * `options` is the CALLER's safety envelope — currently a hard row ceiling
   * for background readers that collapse a timeseries to a scalar. It is not
   * part of the wire input, so an API client cannot raise its own limit.
   */
  async getTimeseries(
    input: TimeseriesInputType,
    options?: TimeseriesReadOptions,
  ): Promise<TimeseriesResult> {
    return this.tracer.withActiveSpan(
      "AnalyticsService.getTimeseries",
      { attributes: { "tenant.id": input.projectId } },
      async () => {
        const hash = createHash("sha256")
          // `options` is part of the cache identity, not a side channel: a
          // bounded read and an unbounded one are different questions, and a
          // shared key would let an unbounded UI result satisfy a bounded
          // background read (or the reverse) purely by arrival order.
          .update(JSON.stringify({ input, options: options ?? null }))
          .digest("hex");
        const cacheKey = `${input.projectId}:${hash}`;
        const cached = await this.timeseriesCache.get(cacheKey);
        if (cached) return cached;

        const table = this.resolveAnalyticsTable(input);

        // Routed → a legacy table: single call, no overhead. Both
        // `trace_summaries` and `evaluation_runs` dispatch through the same
        // legacy shim — `buildTimeseriesQuery` handles both registries.
        if (table === "trace_summaries" || table === "evaluation_runs") {
          const result = await this.deps.legacyShim.run(input, options);
          await this.timeseriesCache.set(cacheKey, result);
          return result;
        }

        const tripwireEnabled = await isTripwireEnabled(input.projectId);
        const legacyForTripwire = this.deps.legacyShim.run.bind(
          this.deps.legacyShim,
        );

        if (!tripwireEnabled) {
          const result = await this.runRouted(table, input, options);
          await this.timeseriesCache.set(cacheKey, result);
          return result;
        }

        // Tripwire: run both queries in parallel; log on divergence; return
        // the routed result so the flag flip behaviour is observable
        // end-to-end. The legacy comparator picks per-source so an
        // eval-routed query is compared against `evaluation_runs`, not
        // `trace_summaries`.
        const [routedResult, legacyResult] = await Promise.all([
          this.runRouted(table, input, options),
          // The comparison read carries the caller's ceiling too. Without it a
          // tripwire-enabled project would still materialise the unbounded
          // legacy result alongside the bounded routed one — the bound would
          // hold everywhere except the projects we turned extra reads on for.
          legacyForTripwire(input, options),
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
   * Which table answers this query — a pure function of the query's SHAPE.
   *
   * `release_event_sourced_analytics_read` used to gate this: off meant every
   * call fell back to `trace_summaries`. The flag is permanently on, so the
   * gate only cost a feature-flag round trip per query to answer "yes".
   *
   * The legacy tables are NOT dead with the gate gone: `pickAnalyticsTable`
   * still routes to `trace_summaries` / `evaluation_runs` for the shapes the
   * slim and rollup builders cannot express (mixed sources, keyed series,
   * `metadata.model` group-bys, trace-id filters). That routing is by shape,
   * never by flag, which is why the shim stays.
   */
  private resolveAnalyticsTable(input: TimeseriesInputType): AnalyticsTable {
    return pickAnalyticsTable({
      series: input.series,
      filters: input.filters,
      groupBy: input.groupBy,
      traceIds: input.traceIds,
      negateFilters: input.negateFilters,
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
    options?: TimeseriesReadOptions,
  ): Promise<TimeseriesResult> {
    const { previousPeriodStartDate, startDate, endDate } =
      currentVsPreviousDates(
        input,
        typeof input.timeScale === "number" ? input.timeScale : undefined,
      );

    const adjustedTimeScale = adjustTimeScaleForBucketCap({
      timeScale: input.timeScale,
      startDate,
      endDate,
    });

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
      return this.deps.rollupRepository.run({
        tenantId: input.projectId,
        builderInput,
        series: input.series,
        groupBy: input.groupBy,
        originalTimeScale: input.timeScale,
        maxResultRows: options?.maxResultRows,
      });
    }
    if (table === "trace_analytics") {
      return this.deps.slimRepository.run({
        tenantId: input.projectId,
        builderInput,
        series: input.series,
        groupBy: input.groupBy,
        originalTimeScale: input.timeScale,
        maxResultRows: options?.maxResultRows,
      });
    }
    if (table === "evaluation_analytics_rollup") {
      return this.deps.evalRollupRepository.run({
        tenantId: input.projectId,
        builderInput,
        series: input.series,
        groupBy: input.groupBy,
        originalTimeScale: input.timeScale,
        maxResultRows: options?.maxResultRows,
      });
    }
    if (table === "evaluation_analytics") {
      return this.deps.evalSlimRepository.run({
        tenantId: input.projectId,
        builderInput,
        series: input.series,
        groupBy: input.groupBy,
        originalTimeScale: input.timeScale,
        maxResultRows: options?.maxResultRows,
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
    // A read tripwire on the analytics hot path. It takes no organization
    // lookup, so only the project targets it.
    { distinctId: projectId, projectId, organizationId: NOT_TARGETED },
  );
}

/**
 * Production wiring for `AnalyticsService`. Takes the resolver and the
 * legacy backend from the caller (`presets.ts`) instead of resolving a
 * ClickHouse client here — the instance this builds is handed out once as
 * `getApp().analytics.service`, not constructed per call site.
 */
export function createAnalyticsService({
  resolveClient,
  legacyBackend,
}: {
  resolveClient: ClickHouseClientResolver;
  legacyBackend: AnalyticsBackend;
}): AnalyticsService {
  return new AnalyticsService({
    rollupRepository: createTraceRollupReadRepo(resolveClient),
    slimRepository: createTraceSlimReadRepo(resolveClient),
    legacyShim: new ClickHouseLegacyAnalyticsShim(resolveClient),
    evalRollupRepository: createEvalRollupReadRepo(resolveClient),
    evalSlimRepository: createEvalSlimReadRepo(resolveClient),
    legacyBackend,
  });
}
