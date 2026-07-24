/**
 * ClickHouse Analytics Service
 *
 * Implements analytics queries using ClickHouse as the data source.
 * This is the CH equivalent of the ES-based timeseries.ts logic.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";
import { getLangWatchTracer } from "langwatch";
import {
  getClickHouseClientForProject,
  isClickHouseEnabled,
} from "../../clickhouse/clickhouseClient";
import type { FilterField } from "../../filters/types";
import type { ElasticSearchEvent } from "../../tracer/types";
import type {
  FeedbacksResult,
  FilterDataResult,
  TimeseriesResult,
  TopDocumentsResult,
} from "../types";
import {
  buildDataForFilterQuery,
  buildFeedbacksQuery,
  buildTopDocumentsQuery,
} from "./aggregation-builder";

/**
 * Default ClickHouse settings applied to all analytics queries.
 *
 * max_memory_usage is intentionally omitted: the ClickHouse server profile
 * already enforces a per-query memory cap via Terraform (1.5–2 GiB depending
 * on cluster). Setting it client-side would override that cap upward, which
 * is counterproductive.
 *
 * max_bytes_before_external_group_by: When GROUP BY intermediate state exceeds
 * this threshold (500 MB), ClickHouse spills to disk instead of failing with OOM.
 * This acts as a safety net for large GROUP BY operations under concurrent load.
 */
export const ANALYTICS_CLICKHOUSE_SETTINGS: Record<string, number> = {
  max_bytes_before_external_group_by: 500_000_000,
};

// Re-export types for backward compatibility
export type {
  FeedbacksResult,
  FilterDataResult,
  TimeseriesResult,
  TopDocumentsResult,
};

/**
 * ClickHouse Analytics Service
 *
 * Provides analytics queries using ClickHouse.
 */
export class ClickHouseAnalyticsService {
  private readonly logger = createLogger("langwatch:analytics:clickhouse");
  private readonly tracer = getLangWatchTracer(
    "langwatch.analytics.clickhouse",
  );

  /**
   * Resolve the ClickHouse client for a given project.
   */
  private async resolveClient(
    projectId: string,
  ): Promise<ClickHouseClient | null> {
    return getClickHouseClientForProject(projectId);
  }

  /**
   * Check if the shared ClickHouse instance is configured (sync, for AnalyticsBackend interface).
   */
  isAvailable(): boolean {
    return isClickHouseEnabled();
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
        const clickHouseClient = await this.resolveClient(projectId);
        if (!clickHouseClient) {
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
          const result = await clickHouseClient.query({
            query: sql,
            query_params: params,
            format: "JSONEachRow",
            clickhouse_settings: ANALYTICS_CLICKHOUSE_SETTINGS,
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
        const clickHouseClient = await this.resolveClient(projectId);
        if (!clickHouseClient) {
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
            clickHouseClient.query({
              query: topDocsSql,
              query_params: params,
              format: "JSONEachRow",
              clickhouse_settings: ANALYTICS_CLICKHOUSE_SETTINGS,
            }),
            clickHouseClient.query({
              query: totalSql,
              query_params: params,
              format: "JSONEachRow",
              clickhouse_settings: ANALYTICS_CLICKHOUSE_SETTINGS,
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
        const clickHouseClient = await this.resolveClient(projectId);
        if (!clickHouseClient) {
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
          const result = await clickHouseClient.query({
            query: sql,
            query_params: params,
            format: "JSONEachRow",
            clickhouse_settings: ANALYTICS_CLICKHOUSE_SETTINGS,
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
