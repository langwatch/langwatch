/**
 * ADR-034 legacy analytics reads that never got an ADR-034 routed
 * replacement: filter-dropdown options, top-used-documents (RAG analytics),
 * and thumbs-up/down feedback events. Moved out of
 * `ClickHouseAnalyticsService` so the query, the tenant scoping, and the row
 * decoding live behind a repository instead of a service resolving a client
 * directly.
 */

import { createLogger } from "@langwatch/observability";
import {
  buildDataForFilterQuery,
  buildFeedbacksQuery,
  buildTopDocumentsQuery,
} from "~/server/analytics/clickhouse/aggregation-builder";
import { ANALYTICS_CLICKHOUSE_SETTINGS } from "~/server/analytics/clickhouse/clickhouse-analytics.service";
import type {
  FeedbacksResult,
  FilterDataResult,
  TopDocumentsResult,
} from "~/server/analytics/types";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { FilterField } from "~/server/filters/types";
import type { ElasticSearchEvent } from "~/server/tracer/types";
import { AnalyticsClientUnavailableError } from "../errors";

const logger = createLogger(
  "langwatch:app-layer:analytics:legacy-backend-repository",
);

type FilterValueMap = Partial<
  Record<
    FilterField,
    | string[]
    | Record<string, string[]>
    | Record<string, Record<string, string[]>>
  >
>;

export interface FindFilterOptionsInput {
  projectId: string;
  field: FilterField;
  startDate: number;
  endDate: number;
  filters?: FilterValueMap;
  key?: string;
  subkey?: string;
  searchQuery?: string;
}

export interface FindTopDocumentsInput {
  projectId: string;
  startDate: number;
  endDate: number;
  filters?: FilterValueMap;
}

export interface FindFeedbacksInput {
  projectId: string;
  startDate: number;
  endDate: number;
  filters?: FilterValueMap;
}

export interface LegacyAnalyticsBackendRepository {
  findFilterOptions(input: FindFilterOptionsInput): Promise<FilterDataResult>;
  findTopDocuments(input: FindTopDocumentsInput): Promise<TopDocumentsResult>;
  findFeedbackEvents(input: FindFeedbacksInput): Promise<FeedbacksResult>;
}

export class LegacyAnalyticsBackendClickHouseRepository
  implements LegacyAnalyticsBackendRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async findFilterOptions({
    projectId,
    field,
    startDate,
    endDate,
    filters,
    key,
    subkey,
    searchQuery,
  }: FindFilterOptionsInput): Promise<FilterDataResult> {
    const client = await this.resolveClient(projectId);
    if (!client) throw new AnalyticsClientUnavailableError(projectId);

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

    logger.debug({ sql, params }, "Executing dataForFilter query");

    try {
      const result = await client.query({
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

      return {
        options: rows.map((row) => ({
          field: row.field,
          label: row.label,
          count:
            typeof row.count === "string" ? parseInt(row.count, 10) : row.count,
        })),
      };
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : error, sql },
        "Failed to execute dataForFilter query",
      );
      throw error;
    }
  }

  async findTopDocuments({
    projectId,
    startDate,
    endDate,
    filters,
  }: FindTopDocumentsInput): Promise<TopDocumentsResult> {
    const client = await this.resolveClient(projectId);
    if (!client) throw new AnalyticsClientUnavailableError(projectId);

    const { sql, params } = buildTopDocumentsQuery(
      projectId,
      new Date(startDate),
      new Date(endDate),
      filters,
    );

    logger.debug({ sql, params }, "Executing topDocuments query");

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

      const [topDocsResult, totalResult] = await Promise.all([
        client.query({
          query: topDocsSql,
          query_params: params,
          format: "JSONEachRow",
          clickhouse_settings: ANALYTICS_CLICKHOUSE_SETTINGS,
        }),
        client.query({
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

      return {
        topDocuments: topDocs.map((doc) => ({
          documentId: doc.documentId,
          count:
            typeof doc.count === "string" ? parseInt(doc.count, 10) : doc.count,
          traceId: doc.traceId,
          content: doc.content,
        })),
        totalUniqueDocuments:
          typeof total === "string" ? parseInt(total, 10) : total,
      };
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : error, sql },
        "Failed to execute topDocuments query",
      );
      throw error;
    }
  }

  async findFeedbackEvents({
    projectId,
    startDate,
    endDate,
    filters,
  }: FindFeedbacksInput): Promise<FeedbacksResult> {
    const client = await this.resolveClient(projectId);
    if (!client) throw new AnalyticsClientUnavailableError(projectId);

    const { sql, params } = buildFeedbacksQuery(
      projectId,
      new Date(startDate),
      new Date(endDate),
      filters,
    );

    logger.debug({ sql, params }, "Executing feedbacks query");

    try {
      const result = await client.query({
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

      const events: ElasticSearchEvent[] = rows.map((row) =>
        toElasticSearchEvent(row, projectId),
      );

      return { events };
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : error, sql },
        "Failed to execute feedbacks query",
      );
      throw error;
    }
  }
}

/**
 * The vote/score attributes arrive under three spellings - plain, `metrics.`
 * prefixed, and `event.metrics.` prefixed - because they have been written by
 * three generations of the ingest path. Everything else is an event detail.
 */
function splitAttributes(attributes: Record<string, string>): {
  metrics: Array<{ key: string; value: number }>;
  eventDetails: Array<{ key: string; value: string }>;
} {
  const metrics: Array<{ key: string; value: number }> = [];
  const eventDetails: Array<{ key: string; value: string }> = [];

  const METRIC_KEYS: Record<string, "vote" | "score"> = {
    vote: "vote",
    "metrics.vote": "vote",
    "event.metrics.vote": "vote",
    score: "score",
    "metrics.score": "score",
    "event.metrics.score": "score",
  };

  for (const [key, value] of Object.entries(attributes)) {
    const metricKey = METRIC_KEYS[key];
    if (metricKey) {
      metrics.push({ key: metricKey, value: parseFloat(value) || 0 });
    } else {
      eventDetails.push({ key, value });
    }
  }

  return { metrics, eventDetails };
}

function toElasticSearchEvent(
  row: {
    event_id: string;
    trace_id: string;
    started_at: number | string;
    event_type: string;
    attributes: Record<string, string>;
  },
  projectId: string,
): ElasticSearchEvent {
  const startedAt =
    typeof row.started_at === "string"
      ? parseInt(row.started_at, 10)
      : row.started_at;
  const { metrics, eventDetails } = splitAttributes(row.attributes);

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
