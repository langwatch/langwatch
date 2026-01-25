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
import { createLogger } from "../../../utils/logger";
import {
  buildTimeseriesQuery,
  buildDataForFilterQuery,
  buildTopDocumentsQuery,
  buildFeedbacksQuery,
} from "./aggregation-builder";
import { buildMetricAlias } from "./metric-translator";
import type { ElasticSearchEvent } from "../../tracer/types";

const logger = createLogger("langwatch:analytics:clickhouse");

/**
 * Timeseries result structure (matches ES output)
 */
export interface TimeseriesResult {
  previousPeriod: TimeseriesBucket[];
  currentPeriod: TimeseriesBucket[];
}

export interface TimeseriesBucket {
  date: string;
  [key: string]: number | string | Record<string, Record<string, number>>;
}

/**
 * Filter data result
 */
export interface FilterDataResult {
  options: Array<{
    field: string;
    label: string;
    count: number;
  }>;
}

/**
 * Top documents result
 */
export interface TopDocumentsResult {
  topDocuments: Array<{
    documentId: string;
    count: number;
    traceId: string;
    content?: string;
  }>;
  totalUniqueDocuments: number;
}

/**
 * Feedbacks result
 */
export interface FeedbacksResult {
  events: ElasticSearchEvent[];
}

/**
 * ClickHouse Analytics Service
 *
 * Provides analytics queries using ClickHouse.
 */
export class ClickHouseAnalyticsService {
  private readonly clickHouseClient: ClickHouseClient | null;
  private readonly logger = createLogger("langwatch:analytics:clickhouse");
  private readonly tracer = getLangWatchTracer("langwatch.analytics.clickhouse");

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
            (endDate.getTime() - startDate.getTime()) / (1000 * 60);
          const estimatedBuckets = totalMinutes / input.timeScale;
          if (estimatedBuckets > 1000) {
            adjustedTimeScale = 24 * 60; // 1 day
          }
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

          // Parse results into the expected format
          const parsedResult = this.parseTimeseriesResults(
            rows,
            input.series,
            input.groupBy,
            input.timeScale,
          );

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
          : (row.date as string) ?? new Date().toISOString();

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
   * Get data for filter dropdown
   */
  async getDataForFilter(
    projectId: string,
    field: FilterField,
    startDate: number,
    endDate: number,
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
                typeof row.count === "string" ? parseInt(row.count, 10) : row.count,
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
          const [topDocsSql, totalSql] = sql.split(";");

          // Execute both queries
          const [topDocsResult, totalResult] = await Promise.all([
            this.clickHouseClient.query({
              query: topDocsSql!,
              query_params: params,
              format: "JSONEachRow",
            }),
            this.clickHouseClient.query({
              query: totalSql!,
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
            const metrics: Array<{ key: string; value: number }> = [];
            const eventDetails: Array<{ key: string; value: string }> = [];

            for (const [key, value] of Object.entries(row.attributes)) {
              if (key === "vote" || key === "score") {
                metrics.push({ key, value: parseFloat(value) || 0 });
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
