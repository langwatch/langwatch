/**
 * Bridge into the legacy `trace_summaries` SQL builder (ADR-034 Phase 3
 * fallback path).
 *
 * The legacy SQL builder + its filter/metric translators are explicitly
 * OUT-OF-SCOPE for this rewrite (see ADR-034 spec). When the routing
 * module returns `"trace_summaries"`, the new analytics service still needs
 * to execute that query — it does so through this shim, which builds via
 * the legacy `buildTimeseriesQuery` and executes via the same ClickHouse
 * pipeline the new repositories use.
 *
 * No business logic here. No SQL templating here. Pure forwarding:
 *
 *   builder (legacy) → CH client → parser (shared with slim/rollup).
 *
 * Preserves the legacy behaviour bit-for-bit for unflagged projects.
 */

import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { currentVsPreviousDates } from "~/server/api/routers/analytics/common";
import { buildTimeseriesQuery } from "~/server/analytics/clickhouse/aggregation-builder";
import { ANALYTICS_CLICKHOUSE_SETTINGS } from "~/server/analytics/clickhouse/clickhouse-analytics.service";
import type { TimeseriesInputType } from "~/server/analytics/registry";
import type { TimeseriesResult } from "~/server/analytics/types";
import { createLogger } from "~/utils/logger/server";
import { AnalyticsClientUnavailableError } from "../errors";
import { parseTimeseriesRows } from "./_timeseries-row-parser";

const logger = createLogger(
  "langwatch:app-layer:analytics:legacy-trace-summaries-shim",
);

/** Maximum number of timeseries buckets before auto-adjusting to daily granularity. */
const MAX_TIMESERIES_BUCKETS = 1000;
const MINUTES_PER_DAY = 24 * 60;
const MS_PER_MINUTE = 1000 * 60;

export interface LegacyTraceSummariesShim {
  runTraceSummariesTimeseries(
    input: TimeseriesInputType,
  ): Promise<TimeseriesResult>;
}

export class ClickHouseLegacyTraceSummariesShim
  implements LegacyTraceSummariesShim
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async runTraceSummariesTimeseries(
    input: TimeseriesInputType,
  ): Promise<TimeseriesResult> {
    if (!input.projectId) {
      throw new Error(
        "LegacyTraceSummariesShim.runTraceSummariesTimeseries: projectId is required",
      );
    }

    const client = await this.resolveClient(input.projectId);
    if (!client) throw new AnalyticsClientUnavailableError(input.projectId);

    const { previousPeriodStartDate, startDate, endDate } =
      currentVsPreviousDates(
        input,
        typeof input.timeScale === "number" ? input.timeScale : undefined,
      );

    // Mirror the legacy bucket-count guard so behaviour stays identical.
    let adjustedTimeScale = input.timeScale;
    if (typeof input.timeScale === "number") {
      const totalMinutes =
        (endDate.getTime() - startDate.getTime()) / MS_PER_MINUTE;
      const estimatedBuckets = totalMinutes / input.timeScale;
      if (estimatedBuckets > MAX_TIMESERIES_BUCKETS) {
        adjustedTimeScale = MINUTES_PER_DAY;
      }
    } else if (input.timeScale === undefined) {
      // Match the legacy default (daily granularity ⇔ ES 1d interval).
      adjustedTimeScale = MINUTES_PER_DAY;
    }

    const { sql, params } = buildTimeseriesQuery({
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
    });

    try {
      const result = await client.query({
        query: sql,
        query_params: params,
        format: "JSONEachRow",
        clickhouse_settings: ANALYTICS_CLICKHOUSE_SETTINGS,
      });
      const rows = (await result.json()) as Array<Record<string, unknown>>;
      return parseTimeseriesRows({
        rows,
        series: input.series,
        groupBy: input.groupBy,
        timeScale: input.timeScale,
      });
    } catch (error) {
      logger.error(
        {
          tenantId: input.projectId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to execute legacy trace_summaries timeseries query",
      );
      throw error;
    }
  }
}
