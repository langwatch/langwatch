import {
  analyticsTimeseriesResultSchema,
  type AnalyticsFeedbackEvent,
  type AnalyticsFeedbacksResult,
  type AnalyticsTopDocumentsResult,
  type AnalyticsTable,
  type AnalyticsTimeseriesInput,
  type AnalyticsTimeseriesResult,
} from "@langwatch/analytics-contract";
import type { Authorization } from "@langwatch/authorization";
import {
  AuthorizedClickHouse,
  type ClickHouseQueryClient,
  tenantScopeKey,
} from "@langwatch/clickhouse-client";
import { createLogger } from "@langwatch/observability";
import { toDate } from "@langwatch/time";
import { z } from "zod";

import { ANALYTICS_CLICKHOUSE_SETTINGS } from "../../rules/clickhouse-settings.rules.ts";
import {
  AnalyticsRepository,
  type AnalyticsFeedbackPageRead,
  type AnalyticsFeedbackPageReadInput,
  type AnalyticsLegacyReadInput,
  type AnalyticsTimeseriesQuery,
} from "../analytics.repository.ts";
import {
  buildFeedbacksPageQuery,
  buildFeedbacksQuery,
  buildTimeseriesQuery,
  buildTopDocumentsQuery,
  type TimeseriesQueryInput,
} from "./clickhouse.aggregation-builder.mapper.ts";
import type { EvaluationAnalyticsClickHouseClient } from "./clickhouse.analytics-persistence.repository.ts";
import { pickAnalyticsTable } from "./clickhouse.analytics-route-table.mapper.ts";
import { buildEvalRollupTimeseriesQuery } from "./clickhouse.eval-rollup-timeseries-query.mapper.ts";
import { buildEvalSlimTimeseriesQuery } from "./clickhouse.eval-slim-timeseries-query.mapper.ts";
import { translatingQueryFailures } from "./clickhouse.query-error-translation.mapper.ts";
import { buildRollupTimeseriesQuery } from "./clickhouse.rollup-timeseries-query.mapper.ts";
import { buildSlimTimeseriesQuery } from "./clickhouse.slim-timeseries-query.mapper.ts";
import { parseTimeseriesRows } from "./clickhouse.timeseries-row-parser.mapper.ts";

class AnalyticsClientUnavailableError extends Error {
  constructor(public readonly tenantId: string) {
    super(`ClickHouse client not available for tenant ${tenantId}`);
    this.name = "AnalyticsClientUnavailableError";
  }
}

/** A series asked under one project and a proof minted for another; nothing is read. */
class AnalyticsProofProjectMismatchError extends Error {
  readonly code = "analytics_proof_project_mismatch";
  constructor(public readonly projectId: string) {
    super(`Analytics proof does not cover project ${projectId} as its own`);
    this.name = "AnalyticsProofProjectMismatchError";
  }
}

type TimeseriesBuilder = (input: TimeseriesQueryInput) => {
  sql: string;
  params: Record<string, unknown>;
};

/**
 * The builder for a table. Every builder writes the proof's markers and is read through the
 * fenced reader (ADR-177); `evaluation_runs` is joined beside trace_summaries, never its own
 * FROM, so both legacy tables share one builder.
 */
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

/** What a timeseries statement is sent through: the fenced reader. */
type TimeseriesStatementClient = {
  query(input: {
    query: string;
    query_params: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings: Record<string, string | number>;
  }): Promise<{ json(): Promise<unknown> }>;
};

/**
 * The fenced reader does not go through the per-tenant session, so its failures are translated
 * here, the same way the session translates the own tenant's (ADR-045).
 */
function translatingFailures(reader: TimeseriesStatementClient): TimeseriesStatementClient {
  return { query: (input) => translatingQueryFailures(() => reader.query(input)) };
}

/** The one ClickHouse persistence implementation for all timeseries tables. */
export class ClickHouseAnalyticsRepository extends AnalyticsRepository {
  static create(options: {
    resolveClient: (tenantId: string) => Promise<EvaluationAnalyticsClickHouseClient | null>;
    /** The routed client the fenced reads go through; the proof picks their tenants. */
    clickhouse: ClickHouseQueryClient;
  }): ClickHouseAnalyticsRepository {
    return new ClickHouseAnalyticsRepository(
      options.resolveClient,
      new AuthorizedClickHouse({ resolveClient: () => Promise.resolve(options.clickhouse) }),
    );
  }

  private readonly logger = createLogger("langwatch:analytics:timeseries-repository");

  private constructor(
    private readonly resolveClient: (
      tenantId: string,
    ) => Promise<EvaluationAnalyticsClickHouseClient | null>,
    private readonly authorized: AuthorizedClickHouse,
  ) {
    super();
  }

  tableFor(input: AnalyticsTimeseriesInput): AnalyticsTable {
    return pickAnalyticsTable(input);
  }

  async runTimeseries(query: AnalyticsTimeseriesQuery): Promise<AnalyticsTimeseriesResult> {
    const projectId = query.input.projectId;
    if (!projectId.trim()) {
      throw new Error("Analytics timeseries projectId is required");
    }
    const build = builderFor(query.table);
    const client = this.statementClient({ authorization: query.authorization, projectId });

    const builderInput: TimeseriesQueryInput = {
      projectId,
      startDate: toDate(query.startDate),
      endDate: toDate(query.endDate),
      previousPeriodStartDate: toDate(query.previousPeriodStartDate),
      series: query.input.series,
      filters: query.input.filters,
      groupBy: query.input.groupBy,
      groupByKey: query.input.groupByKey,
      timeScale: query.adjustedTimeScale,
      timeZone: query.input.timeZone,
      traceIds: query.input.traceIds,
      negateFilters: query.input.negateFilters,
      excludeOrigins: query.input.excludeOrigins,
    };
    const built = build(builderInput);

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
          tenantId: projectId,
          scope: tenantScopeKey({ authorization: query.authorization, reads: "analytics" }),
          table: query.table,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to execute Analytics timeseries query",
      );
      throw error;
    }
  }

  async findTopDocuments(input: AnalyticsLegacyReadInput): Promise<AnalyticsTopDocumentsResult> {
    const client = await this.clientFor(input.projectId);
    const built = buildTopDocumentsQuery({
      projectId: input.projectId,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
      filters: input.filters,
    });
    try {
      const result = await client.query({
        query: built.sql,
        query_params: built.params,
        format: "JSONEachRow",
        clickhouse_settings: ANALYTICS_CLICKHOUSE_SETTINGS,
      });
      const topDocs = (await result.json()) as {
        documentId: string;
        count: string | number;
        traceId: string;
        content?: string;
        total: string | number;
      }[];
      // Every row carries the distinct-document total; no rows means none.
      const total = topDocs[0]?.total ?? 0;
      return {
        topDocuments: topDocs.map((doc) => ({
          documentId: doc.documentId,
          count: typeof doc.count === "string" ? parseInt(doc.count, 10) : doc.count,
          traceId: doc.traceId,
          content: doc.content,
        })),
        totalUniqueDocuments: typeof total === "string" ? parseInt(total, 10) : total,
      };
    } catch (error) {
      this.logger.warn(
        {
          tenantId: input.projectId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to execute topDocuments query",
      );
      throw error;
    }
  }

  async findFeedbackEvents(input: AnalyticsLegacyReadInput): Promise<AnalyticsFeedbacksResult> {
    const client = await this.clientFor(input.projectId);
    const built = buildFeedbacksQuery({
      projectId: input.projectId,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
      filters: input.filters,
    });
    try {
      const result = await client.query({
        query: built.sql,
        query_params: built.params,
        format: "JSONEachRow",
        clickhouse_settings: ANALYTICS_CLICKHOUSE_SETTINGS,
      });
      const rows = (await result.json()) as {
        trace_id: string;
        event_id: string;
        started_at: string | number;
        event_type: string;
        attributes: Record<string, string>;
      }[];
      return {
        events: rows.map((row) => toFeedbackEvent(row, input.projectId)),
      };
    } catch (error) {
      this.logger.warn(
        {
          tenantId: input.projectId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to execute feedbacks query",
      );
      throw error;
    }
  }

  async findFeedbackEventsPage(
    input: AnalyticsFeedbackPageReadInput,
  ): Promise<AnalyticsFeedbackPageRead> {
    const client = await this.clientFor(input.projectId);
    const built = buildFeedbacksPageQuery({
      projectId: input.projectId,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
      filters: input.filters,
      after: input.after,
      limit: input.limit,
    });
    try {
      const result = await client.query({
        query: built.sql,
        query_params: built.params,
        format: "JSONEachRow",
        clickhouse_settings: ANALYTICS_CLICKHOUSE_SETTINGS,
      });
      const fetched = feedbackPageRowsSchema.parse(await result.json());
      return {
        rows: fetched.slice(0, input.limit).map((row) => ({
          event: toFeedbackEvent(row, input.projectId),
          position: {
            startedAt: startedAtOf(row),
            traceId: row.trace_id,
            spanId: row.event_id,
            eventIndex: row.event_index,
          },
        })),
        hasMore: fetched.length > input.limit,
      };
    } catch (error) {
      this.logger.warn(
        {
          tenantId: input.projectId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to execute feedbacks page query",
      );
      throw error;
    }
  }

  /**
   * The fenced reader a series is sent through. The proof must be for the input's project, so
   * a series cannot be asked under one project and read under another's.
   */
  private statementClient({
    authorization,
    projectId,
  }: {
    authorization: Authorization;
    projectId: string;
  }): TimeseriesStatementClient {
    const reader = this.authorized.as(authorization, { reads: "analytics" });
    if (!reader.fence.own.includes(projectId)) {
      throw new AnalyticsProofProjectMismatchError(projectId);
    }
    return translatingFailures(reader);
  }

  private async clientFor(tenantId: string): Promise<EvaluationAnalyticsClickHouseClient> {
    const client = await this.resolveClient(tenantId);
    if (!client) throw new AnalyticsClientUnavailableError(tenantId);
    return client;
  }
}

const feedbackRowSchema = z.object({
  trace_id: z.string(),
  event_id: z.string(),
  started_at: z.union([z.string(), z.number()]),
  event_type: z.string(),
  attributes: z.record(z.string(), z.string()),
});
const feedbackPageRowsSchema = z.array(
  z.object({ ...feedbackRowSchema.shape, event_index: z.number() }),
);

function startedAtOf(row: z.infer<typeof feedbackRowSchema>): number {
  return typeof row.started_at === "string" ? parseInt(row.started_at, 10) : row.started_at;
}

function toFeedbackEvent(
  row: z.infer<typeof feedbackRowSchema>,
  projectId: string,
): AnalyticsFeedbackEvent {
  const metrics: { key: string; value: number }[] = [];
  const eventDetails: { key: string; value: string }[] = [];
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
  const startedAt = startedAtOf(row);
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
