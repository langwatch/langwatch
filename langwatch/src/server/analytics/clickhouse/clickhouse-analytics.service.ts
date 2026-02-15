/**
 * ClickHouse Analytics Service
 *
 * Implements analytics queries using ClickHouse as the data source.
 * This is the CH equivalent of the ES-based timeseries.ts logic.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { getLangWatchTracer } from "langwatch";
import { getClickHouseClient } from "../../clickhouse/client";
import type { FilterField } from "../../filters/types";
import type { TimeseriesInputType, SeriesInputType } from "../registry";
import { currentVsPreviousDates } from "../../api/routers/analytics/common";
import { createLogger } from "../../../utils/logger/server";
import {
  buildTimeseriesQuery,
  buildDataForFilterQuery,
  buildTopDocumentsQuery,
  buildFeedbacksQuery,
} from "./aggregation-builder";
import { buildMetricAlias } from "./metric-translator";
import type {
  TimeseriesResult,
  TimeseriesBucket,
  FilterDataResult,
  TopDocumentsResult,
  FeedbacksResult,
} from "../types";
import type { ElasticSearchEvent } from "../../tracer/types";

/** Maximum number of timeseries buckets before auto-adjusting to daily granularity */
const MAX_TIMESERIES_BUCKETS = 1000;
/** Minutes in a day - used for daily timeScale */
const MINUTES_PER_DAY = 24 * 60;
/** Milliseconds per minute for time calculations */
const MS_PER_MINUTE = 1000 * 60;

// Re-export types for backward compatibility
export type {
  TimeseriesResult,
  FilterDataResult,
  TopDocumentsResult,
  FeedbacksResult,
};

/**
 * ClickHouse Analytics Service
 *
 * Provides analytics queries using ClickHouse.
 */
export class ClickHouseAnalyticsService {
  private readonly clickHouseClient: ClickHouseClient | null;
  private readonly logger = createLogger("langwatch:analytics:clickhouse");
  private readonly tracer = getLangWatchTracer(
    "langwatch.analytics.clickhouse",
  );

  constructor() {
    this.clickHouseClient = getClickHouseClient();
  }

  /**
   * Check if ClickHouse client is available
   */
  isAvailable(): boolean {
    return this.clickHouseClient !== null;
  }

  /**
   * Execute timeseries query
   */
  async getTimeseries(input: TimeseriesInputType): Promise<TimeseriesResult> {
    return this.tracer.withActiveSpan(
      "ClickHouseAnalyticsService.getTimeseries",
      { attributes: { "tenant.id": input.projectId } },
      async (span) => {
        if (!this.clickHouseClient) {
          throw new Error("ClickHouse client not available");
        }

        const { previousPeriodStartDate, startDate, endDate } =
          currentVsPreviousDates(
            input,
            typeof input.timeScale === "number" ? input.timeScale : undefined,
          );

        // Adjust timeScale to avoid too many buckets
        let adjustedTimeScale = input.timeScale;
        if (typeof input.timeScale === "number") {
          const totalMinutes =
            (endDate.getTime() - startDate.getTime()) / MS_PER_MINUTE;
          const estimatedBuckets = totalMinutes / input.timeScale;
          if (estimatedBuckets > MAX_TIMESERIES_BUCKETS) {
            adjustedTimeScale = MINUTES_PER_DAY;
          }
        } else if (input.timeScale === undefined) {
          // Default to daily granularity to match ES behavior (fixed_interval: "1d")
          adjustedTimeScale = MINUTES_PER_DAY;
        }

        // Build the query
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

        this.logger.debug({ sql, params }, "Executing timeseries query");

        try {
          const result = await this.clickHouseClient.query({
            query: sql,
            query_params: params,
            format: "JSONEachRow",
          });

          const rows = (await result.json()) as Array<Record<string, unknown>>;

          // Debug logging for analytics queries
          if (process.env.DEBUG_ANALYTICS === "true") {
            this.logger.info(
              {
                series: input.series.map((s, i) => ({
                  index: i,
                  metric: s.metric,
                  aggregation: s.aggregation,
                  pipeline: s.pipeline,
                  alias: buildMetricAlias(
                    i,
                    s.metric,
                    s.aggregation,
                    s.key,
                    s.subkey,
                  ),
                })),
                rowCount: rows.length,
                sampleRow: rows[0],
                columnNames: rows[0] ? Object.keys(rows[0]) : [],
              },
              "Analytics query debug info",
            );
          }

          // Parse results into the expected format
          const parsedResult = this.parseTimeseriesResults(
            rows,
            input.series,
            input.groupBy,
            input.timeScale,
          );

          // Debug logging for parsed results
          if (process.env.DEBUG_ANALYTICS === "true") {
            this.logger.info(
              {
                currentPeriod: parsedResult.currentPeriod,
                previousPeriod: parsedResult.previousPeriod,
              },
              "Analytics parsed results",
            );
          }

          span.setAttribute("bucket.count", parsedResult.currentPeriod.length);

          return parsedResult;
        } catch (error) {
          this.logger.error(
            { error: error instanceof Error ? error.message : error, sql },
            "Failed to execute timeseries query",
          );
          throw error;
        }
      },
    );
  }

  /**
   * Parse ClickHouse timeseries results into ES-compatible format
   */
  private parseTimeseriesResults(
    rows: Array<Record<string, unknown>>,
    series: SeriesInputType[],
    groupBy?: string,
    timeScale?: number | "full",
  ): TimeseriesResult {
    const previousPeriod: TimeseriesBucket[] = [];
    const currentPeriod: TimeseriesBucket[] = [];

    // Group rows by period and date
    const bucketMap: {
      previous: Map<string, TimeseriesBucket>;
      current: Map<string, TimeseriesBucket>;
    } = {
      previous: new Map(),
      current: new Map(),
    };

    for (const row of rows) {
      const period = row.period as string;
      const dateKey =
        timeScale === "full"
          ? "full"
          : ((row.date as string) ?? new Date().toISOString());

      const targetMap =
        period === "current" ? bucketMap.current : bucketMap.previous;

      let bucket = targetMap.get(dateKey);
      if (!bucket) {
        bucket = { date: dateKey };
        targetMap.set(dateKey, bucket);
      }

      // Extract metric values
      if (groupBy && row.group_key !== undefined && row.group_key !== null) {
        // Grouped results
        const groupKey = String(row.group_key);
        if (!bucket[groupBy]) {
          bucket[groupBy] = {};
        }
        const groupData = bucket[groupBy] as Record<
          string,
          Record<string, number>
        >;
        if (!groupData[groupKey]) {
          groupData[groupKey] = {};
        }

        for (let i = 0; i < series.length; i++) {
          const seriesItem = series[i]!;
          const alias = buildMetricAlias(
            i,
            seriesItem.metric,
            seriesItem.aggregation,
            seriesItem.key,
            seriesItem.subkey,
          );
          const seriesName = this.buildSeriesName(seriesItem, i);
          const value = row[alias];
          if (value !== undefined && value !== null) {
            groupData[groupKey]![seriesName] = Number(value);
          }
        }
      } else {
        // Non-grouped results
        for (let i = 0; i < series.length; i++) {
          const seriesItem = series[i]!;
          const alias = buildMetricAlias(
            i,
            seriesItem.metric,
            seriesItem.aggregation,
            seriesItem.key,
            seriesItem.subkey,
          );
          const seriesName = this.buildSeriesName(seriesItem, i);
          const value = row[alias];
          if (value !== undefined && value !== null) {
            bucket[seriesName] = Number(value);
          }
        }
      }
    }

    // Convert maps to sorted arrays
    for (const [_, bucket] of Array.from(bucketMap.previous.entries()).sort(
      ([a], [b]) => a.localeCompare(b),
    )) {
      previousPeriod.push(bucket);
    }
    for (const [_, bucket] of Array.from(bucketMap.current.entries()).sort(
      ([a], [b]) => a.localeCompare(b),
    )) {
      currentPeriod.push(bucket);
    }

    // Correction for when previous period has more buckets than current
    const correctedPrevious = previousPeriod.slice(
      Math.max(0, previousPeriod.length - currentPeriod.length),
    );

    // Ensure both periods have all expected metrics with default values of 0
    // This handles cases where ClickHouse returns NULL for pipeline metrics in one period
    // (e.g., when a subquery returns no results for the previous period)
    this.normalizeMetricKeys(correctedPrevious, currentPeriod, groupBy);

    return {
      previousPeriod: correctedPrevious,
      currentPeriod,
    };
  }

  /**
   * Build series name for result key (matches ES format)
   */
  private buildSeriesName(series: SeriesInputType, index: number): string {
    const aggregation =
      series.aggregation === "terms" ? "cardinality" : series.aggregation;

    if (series.pipeline) {
      return `${index}/${series.metric}/${aggregation}/${series.pipeline.field}/${series.pipeline.aggregation}`;
    }

    if (series.key) {
      return `${index}/${series.metric}/${aggregation}/${series.key}`;
    }

    return `${index}/${series.metric}/${aggregation}`;
  }

  /**
   * Normalize metric keys across both periods to ensure all buckets have all metrics.
   * This is necessary because ClickHouse may return NULL for pipeline metrics in one period
   * (e.g., when a subquery returns no results), causing the metric to be missing entirely.
   * Without this normalization, the frontend cannot calculate % change for missing metrics.
   */
  private normalizeMetricKeys(
    previousPeriod: TimeseriesBucket[],
    currentPeriod: TimeseriesBucket[],
    groupBy?: string,
  ): void {
    // Collect all top-level metric keys from both periods
    const allMetricKeys = new Set<string>();
    // Collect all metric sub-keys across all groups (union of metric names)
    const allGroupedMetricSubKeys = new Set<string>();

    for (const bucket of [...previousPeriod, ...currentPeriod]) {
      for (const key of Object.keys(bucket)) {
        if (key === "date") continue;

        const value = bucket[key];

        if (
          groupBy &&
          key === groupBy &&
          typeof value === "object" &&
          value !== null
        ) {
          const groupData = value as Record<string, Record<string, number>>;
          for (const metrics of Object.values(groupData)) {
            for (const metricKey of Object.keys(metrics)) {
              allGroupedMetricSubKeys.add(metricKey);
            }
          }
        } else {
          allMetricKeys.add(key);
        }
      }
    }

    // Ensure all buckets have all metric keys with default value of 0
    for (const bucket of [...previousPeriod, ...currentPeriod]) {
      // Normalize top-level metrics
      for (const key of allMetricKeys) {
        if (bucket[key] === undefined) {
          bucket[key] = 0;
        }
      }

      // Normalize grouped metrics: only fill in missing metric sub-keys
      // for groups that already exist in this bucket. Do NOT create new
      // groups from the other period — that would bleed stale dimension
      // values across periods.
      if (groupBy && bucket[groupBy] && typeof bucket[groupBy] === "object") {
        const groupData = bucket[groupBy] as Record<
          string,
          Record<string, number>
        >;

        for (const groupKey of Object.keys(groupData)) {
          for (const metricKey of allGroupedMetricSubKeys) {
            if (groupData[groupKey]![metricKey] === undefined) {
              groupData[groupKey]![metricKey] = 0;
            }
          }
        }
      }
    }
  }

  /**
   * Get data for filter dropdown
   */
  async getDataForFilter(
    projectId: string,
    field: FilterField,
    startDate: number,
    endDate: number,
    filters?: Partial<
      Record<
        FilterField,
        | string[]
        | Record<string, string[]>
        | Record<string, Record<string, string[]>>
      >
    >,
    key?: string,
    subkey?: string,
    searchQuery?: string,
  ): Promise<FilterDataResult> {
    return this.tracer.withActiveSpan(
      "ClickHouseAnalyticsService.getDataForFilter",
      { attributes: { "tenant.id": projectId, "filter.field": field } },
      async (span) => {
        if (!this.clickHouseClient) {
          throw new Error("ClickHouse client not available");
        }

        const { sql, params } = buildDataForFilterQuery(
          projectId,
          field,
          new Date(startDate),
          new Date(endDate),
          key,
          subkey,
          searchQuery,
          filters,
        );

        this.logger.debug({ sql, params }, "Executing dataForFilter query");

        try {
          const result = await this.clickHouseClient.query({
            query: sql,
            query_params: params,
            format: "JSONEachRow",
          });

          const rows = (await result.json()) as Array<{
            field: string;
            label: string;
            count: string | number;
          }>;

          span.setAttribute("result.count", rows.length);

          return {
            options: rows.map((row) => ({
              field: row.field,
              label: row.label,
              count:
                typeof row.count === "string"
                  ? parseInt(row.count, 10)
                  : row.count,
            })),
          };
        } catch (error) {
          this.logger.error(
            { error: error instanceof Error ? error.message : error, sql },
            "Failed to execute dataForFilter query",
          );
          throw error;
        }
      },
    );
  }

  /**
   * Get top used documents (RAG analytics)
   */
  async getTopUsedDocuments(
    projectId: string,
    startDate: number,
    endDate: number,
    filters?: Partial<
      Record<
        FilterField,
        | string[]
        | Record<string, string[]>
        | Record<string, Record<string, string[]>>
      >
    >,
  ): Promise<TopDocumentsResult> {
    return this.tracer.withActiveSpan(
      "ClickHouseAnalyticsService.getTopUsedDocuments",
      { attributes: { "tenant.id": projectId } },
      async (span) => {
        if (!this.clickHouseClient) {
          throw new Error("ClickHouse client not available");
        }

        const { sql, params } = buildTopDocumentsQuery(
          projectId,
          new Date(startDate),
          new Date(endDate),
          filters,
        );

        this.logger.debug({ sql, params }, "Executing topDocuments query");

        try {
          // The query has two parts separated by semicolon
          const parts = sql.split(";");
          if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) {
            throw new Error(
              `Expected topDocuments query to have exactly 2 non-empty statements ` +
                `separated by semicolon, got ${parts.length} parts`,
            );
          }
          const [topDocsSql, totalSql] = parts;

          // Execute both queries
          const [topDocsResult, totalResult] = await Promise.all([
            this.clickHouseClient.query({
              query: topDocsSql,
              query_params: params,
              format: "JSONEachRow",
            }),
            this.clickHouseClient.query({
              query: totalSql,
              query_params: params,
              format: "JSONEachRow",
            }),
          ]);

          const topDocs = (await topDocsResult.json()) as Array<{
            documentId: string;
            count: string | number;
            traceId: string;
            content?: string;
          }>;

          const totalRows = (await totalResult.json()) as Array<{
            total: string | number;
          }>;

          const total = totalRows[0]?.total ?? 0;

          span.setAttribute("document.count", topDocs.length);

          return {
            topDocuments: topDocs.map((doc) => ({
              documentId: doc.documentId,
              count:
                typeof doc.count === "string"
                  ? parseInt(doc.count, 10)
                  : doc.count,
              traceId: doc.traceId,
              content: doc.content,
            })),
            totalUniqueDocuments:
              typeof total === "string" ? parseInt(total, 10) : total,
          };
        } catch (error) {
          this.logger.error(
            { error: error instanceof Error ? error.message : error, sql },
            "Failed to execute topDocuments query",
          );
          throw error;
        }
      },
    );
  }

  /**
   * Get feedbacks (thumbs up/down events with feedback text)
   */
  async getFeedbacks(
    projectId: string,
    startDate: number,
    endDate: number,
    filters?: Partial<
      Record<
        FilterField,
        | string[]
        | Record<string, string[]>
        | Record<string, Record<string, string[]>>
      >
    >,
  ): Promise<FeedbacksResult> {
    return this.tracer.withActiveSpan(
      "ClickHouseAnalyticsService.getFeedbacks",
      { attributes: { "tenant.id": projectId } },
      async (span) => {
        if (!this.clickHouseClient) {
          throw new Error("ClickHouse client not available");
        }

        const { sql, params } = buildFeedbacksQuery(
          projectId,
          new Date(startDate),
          new Date(endDate),
          filters,
        );

        this.logger.debug({ sql, params }, "Executing feedbacks query");

        try {
          const result = await this.clickHouseClient.query({
            query: sql,
            query_params: params,
            format: "JSONEachRow",
          });

          const rows = (await result.json()) as Array<{
            trace_id: string;
            event_id: string;
            started_at: string | number;
            event_type: string;
            attributes: Record<string, string>;
          }>;

          // Convert to ElasticSearchEvent format
          const events: ElasticSearchEvent[] = rows.map((row) => {
            const startedAt =
              typeof row.started_at === "string"
                ? parseInt(row.started_at, 10)
                : row.started_at;

            // Parse attributes into metrics and event_details
            // Handle both plain keys (vote, score) and namespaced keys (event.metrics.vote, metrics.vote)
            const metrics: Array<{ key: string; value: number }> = [];
            const eventDetails: Array<{ key: string; value: string }> = [];

            for (const [key, value] of Object.entries(row.attributes)) {
              // Check for metric keys - both plain and namespaced forms
              const isVoteKey =
                key === "vote" ||
                key === "metrics.vote" ||
                key === "event.metrics.vote";
              const isScoreKey =
                key === "score" ||
                key === "metrics.score" ||
                key === "event.metrics.score";

              if (isVoteKey || isScoreKey) {
                // Use the plain key name for consistency with ES format
                const metricKey = isVoteKey ? "vote" : "score";
                metrics.push({ key: metricKey, value: parseFloat(value) || 0 });
              } else {
                eventDetails.push({ key, value });
              }
            }

            return {
              event_id: row.event_id,
              event_type: row.event_type,
              project_id: projectId,
              trace_id: row.trace_id,
              timestamps: {
                started_at: startedAt,
                inserted_at: startedAt,
                updated_at: startedAt,
              },
              metrics,
              event_details: eventDetails,
            };
          });

          span.setAttribute("event.count", events.length);

          return { events };
        } catch (error) {
          this.logger.error(
            { error: error instanceof Error ? error.message : error, sql },
            "Failed to execute feedbacks query",
          );
          throw error;
        }
      },
    );
  }
}

/**
 * Singleton instance
 */
let clickHouseAnalyticsService: ClickHouseAnalyticsService | null = null;

/**
 * Get the ClickHouse analytics service instance
 */
export function getClickHouseAnalyticsService(): ClickHouseAnalyticsService {
  if (!clickHouseAnalyticsService) {
    clickHouseAnalyticsService = new ClickHouseAnalyticsService();
  }
  return clickHouseAnalyticsService;
}
