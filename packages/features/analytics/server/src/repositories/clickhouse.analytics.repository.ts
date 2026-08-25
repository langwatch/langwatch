import { createLogger } from "@langwatch/observability";
import type { ClickHouseClient } from "@clickhouse/client";
import {
  analyticsTimeseriesResultSchema,
  type AnalyticsFeedbacksResult,
  type AnalyticsTopDocumentsResult,
  type AnalyticsTable,
  type AnalyticsTimeseriesResult,
} from "@langwatch/analytics-contract";
import {
  buildFeedbacksQuery,
  buildTimeseriesQuery,
  buildTopDocumentsQuery,
} from "../clickhouse/aggregation-builder";
import { ANALYTICS_CLICKHOUSE_SETTINGS } from "../clickhouse/settings";
import { buildEvalRollupTimeseriesQuery } from "../query-builders/eval-rollup-timeseries-query";
import { buildEvalSlimTimeseriesQuery } from "../query-builders/eval-slim-timeseries-query";
import { buildRollupTimeseriesQuery } from "../query-builders/rollup-timeseries-query";
import { buildSlimTimeseriesQuery } from "../query-builders/slim-timeseries-query";
import type { AnalyticsTimeseriesBuilderInput } from "../types";
import {
  AnalyticsRepository,
  type AnalyticsLegacyReadInput,
  type AnalyticsTimeseriesQuery,
} from "./analytics.repository";
import { parseTimeseriesRows } from "./timeseries-row-parser";

export class AnalyticsClientUnavailableError extends Error {
  constructor(public readonly tenantId: string) {
    super(`ClickHouse client not available for tenant ${tenantId}`);
    this.name = "AnalyticsClientUnavailableError";
  }
}

type TimeseriesBuilder = (
  input: AnalyticsTimeseriesBuilderInput,
) => { sql: string; params: Record<string, unknown> };

const builderFor = (table: AnalyticsTable): TimeseriesBuilder => {
  switch (table) {
    case "trace_analytics_rollup":
      return buildRollupTimeseriesQuery;
    case "trace_analytics":
      return buildSlimTimeseriesQuery;
    case "evaluation_analytics_rollup":
      return buildEvalRollupTimeseriesQuery;
    case "evaluation_analytics":
      return buildEvalSlimTimeseriesQuery;
    case "trace_summaries":
    case "evaluation_runs":
      return buildTimeseriesQuery;
    default: {
      const exhaustive: never = table;
      throw new Error(`Unknown Analytics table ${String(exhaustive)}`);
    }
  }
};

/** The one ClickHouse persistence implementation for all timeseries tables. */
export class ClickHouseAnalyticsRepository extends AnalyticsRepository {
  static create(options: {
    resolveClient: (
      tenantId: string,
    ) => Promise<ClickHouseClient | null>;
  }): ClickHouseAnalyticsRepository {
    return new ClickHouseAnalyticsRepository(options.resolveClient);
  }

  private readonly logger = createLogger(
    "langwatch:analytics:timeseries-repository",
  );

  private constructor(
    private readonly resolveClient: (
      tenantId: string,
    ) => Promise<ClickHouseClient | null>,
  ) {
    super();
  }

  async runTimeseries(
    query: AnalyticsTimeseriesQuery,
  ): Promise<AnalyticsTimeseriesResult> {
    if (!query.tenantId.trim()) {
      throw new Error("Analytics timeseries tenantId is required");
    }
    const client = await this.resolveClient(query.tenantId);
    if (!client) throw new AnalyticsClientUnavailableError(query.tenantId);

    const builderInput = {
      projectId: query.tenantId,
      startDate: query.startDate,
      endDate: query.endDate,
      previousPeriodStartDate: query.previousPeriodStartDate,
      series: query.input.series,
      filters: query.input.filters,
      groupBy: query.input.groupBy,
      groupByKey: query.input.groupByKey,
      timeScale: query.adjustedTimeScale,
      timeZone: query.input.timeZone,
      traceIds: query.input.traceIds,
      negateFilters: query.input.negateFilters,
    } as AnalyticsTimeseriesBuilderInput;
    const built = builderFor(query.table)(builderInput);

    try {
      const response = await client.query({
        query: built.sql,
        query_params: built.params,
        format: "JSONEachRow",
        clickhouse_settings: {
          ...ANALYTICS_CLICKHOUSE_SETTINGS,
          log_comment: `analytics:timeseries:${query.table}`,
          ...(query.maxResultRows === undefined
            ? {}
            : {
                max_result_rows: String(query.maxResultRows),
                result_overflow_mode: "throw",
              }),
        },
      });
      const rows = await response.json();
      const result = parseTimeseriesRows({
        rows: Array.isArray(rows) ? rows : [],
        series: query.input.series,
        groupBy: query.input.groupBy,
        timeScale: query.input.timeScale,
      });
      return analyticsTimeseriesResultSchema.parse(result);
    } catch (error) {
      this.logger.warn(
        {
          tenantId: query.tenantId,
          table: query.table,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to execute Analytics timeseries query",
      );
      throw error;
    }
  }

  async findTopDocuments(
    input: AnalyticsLegacyReadInput,
  ): Promise<AnalyticsTopDocumentsResult> {
    const client = await this.clientFor(input.projectId);
    const built = buildTopDocumentsQuery(
      input.projectId,
      new Date(input.startDate),
      new Date(input.endDate),
      input.filters,
    );
    const parts = built.sql.split(";");
    if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) {
      throw new Error(
        `Expected topDocuments query to have exactly 2 non-empty statements separated by semicolon, got ${parts.length} parts`,
      );
    }
    try {
      const [topDocsResult, totalResult] = await Promise.all([
        client.query({
          query: parts[0],
          query_params: built.params,
          format: "JSONEachRow",
          clickhouse_settings: ANALYTICS_CLICKHOUSE_SETTINGS,
        }),
        client.query({
          query: parts[1],
          query_params: built.params,
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
      const totals = (await totalResult.json()) as Array<{
        total: string | number;
      }>;
      const total = totals[0]?.total ?? 0;
      return {
        topDocuments: topDocs.map((doc) => ({
          documentId: doc.documentId,
          count: typeof doc.count === "string" ? parseInt(doc.count, 10) : doc.count,
          traceId: doc.traceId,
          content: doc.content,
        })),
        totalUniqueDocuments:
          typeof total === "string" ? parseInt(total, 10) : total,
      };
    } catch (error) {
      this.logger.warn(
        { tenantId: input.projectId, error: error instanceof Error ? error.message : String(error) },
        "Failed to execute topDocuments query",
      );
      throw error;
    }
  }

  async findFeedbackEvents(
    input: AnalyticsLegacyReadInput,
  ): Promise<AnalyticsFeedbacksResult> {
    const client = await this.clientFor(input.projectId);
    const built = buildFeedbacksQuery(
      input.projectId,
      new Date(input.startDate),
      new Date(input.endDate),
      input.filters,
    );
    try {
      const result = await client.query({
        query: built.sql,
        query_params: built.params,
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
      return {
        events: rows.map((row) => toFeedbackEvent(row, input.projectId)),
      };
    } catch (error) {
      this.logger.warn(
        { tenantId: input.projectId, error: error instanceof Error ? error.message : String(error) },
        "Failed to execute feedbacks query",
      );
      throw error;
    }
  }

  private async clientFor(tenantId: string): Promise<ClickHouseClient> {
    const client = await this.resolveClient(tenantId);
    if (!client) throw new AnalyticsClientUnavailableError(tenantId);
    return client;
  }
}

function toFeedbackEvent(
  row: {
    trace_id: string;
    event_id: string;
    started_at: string | number;
    event_type: string;
    attributes: Record<string, string>;
  },
  projectId: string,
) {
  const metrics: Array<{ key: string; value: number }> = [];
  const eventDetails: Array<{ key: string; value: string }> = [];
  const metricKeys: Record<string, string> = {
    vote: "vote",
    "metrics.vote": "vote",
    "event.metrics.vote": "vote",
    score: "score",
    "metrics.score": "score",
    "event.metrics.score": "score",
  };
  for (const [key, value] of Object.entries(row.attributes)) {
    const metricKey = metricKeys[key];
    if (metricKey) metrics.push({ key: metricKey, value: parseFloat(value) || 0 });
    else eventDetails.push({ key, value });
  }
  const startedAt = typeof row.started_at === "string"
    ? parseInt(row.started_at, 10)
    : row.started_at;
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
}
