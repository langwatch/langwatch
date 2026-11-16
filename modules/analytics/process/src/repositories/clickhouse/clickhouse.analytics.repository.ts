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
import {
  type ProofScope,
  type ReaderReadStatement,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import { createLogger } from "@langwatch/observability";
import { toDate } from "@langwatch/time";
import { z } from "zod";

import { ANALYTICS_CLICKHOUSE_SETTINGS } from "../../rules/clickhouse-settings.rules.ts";
import {
  AnalyticsRepository,
  type AnalyticsFeedbackPageRead,
  type AnalyticsFeedbackPageReadInput,
  type AnalyticsLegacyReadInput,
  type AnalyticsTableReadScope,
  type AnalyticsTimeseriesQuery,
} from "../analytics.repository.ts";
import {
  buildTimeseriesQuery,
  type TimeseriesQueryInput,
} from "./clickhouse.aggregation-builder.mapper.ts";
import { pickAnalyticsTable } from "./clickhouse.analytics-route-table.mapper.ts";
import { evalRollupTimeseriesRead } from "./clickhouse.eval-rollup-timeseries-query.mapper.ts";
import { evalSlimTimeseriesRead } from "./clickhouse.eval-slim-timeseries-query.mapper.ts";
import {
  feedbacksPageRead,
  feedbacksRead,
  topDocumentsRead,
} from "./clickhouse.feedback-document-reads.mapper.ts";
import {
  joinedTimeseriesRead,
  servesJoinedTraceSummaries,
} from "./clickhouse.joined-timeseries-query.mapper.ts";
import {
  mixedEvalTimeseriesRead,
  servesMixedEval,
} from "./clickhouse.mixed-eval-timeseries-query.mapper.ts";
import { translatingQueryFailures } from "./clickhouse.query-error-translation.mapper.ts";
import { rollupTimeseriesRead } from "./clickhouse.rollup-timeseries-query.mapper.ts";
import { slimTimeseriesRead } from "./clickhouse.slim-timeseries-query.mapper.ts";
import {
  servesSpanGrouped,
  spanGroupedTimeseriesRead,
} from "./clickhouse.span-grouped-timeseries-query.mapper.ts";
import type { TimeseriesRead } from "./clickhouse.timeseries-query-shared.mapper.ts";
import { parseTimeseriesRows } from "./clickhouse.timeseries-row-parser.mapper.ts";
import {
  servesStandardTraceSummaries,
  traceSummariesTimeseriesRead,
} from "./clickhouse.trace-summaries-timeseries-query.mapper.ts";

/** A series asked under one project and a proof minted for another; nothing is read. */
class AnalyticsProofProjectMismatchError extends Error {
  readonly code = "analytics_proof_project_mismatch";
  constructor(public readonly projectId: string) {
    super(`Analytics proof does not cover project ${projectId} as its own`);
    this.name = "AnalyticsProofProjectMismatchError";
  }
}

/** The tables read on the typed builder (ADR-202); trace_summaries and evaluation_runs are text. */
const BUILT_READS: Partial<Record<AnalyticsTable, (read: TimeseriesRead) => ReaderReadStatement>> =
  {
    trace_analytics_rollup: rollupTimeseriesRead,
    trace_analytics: slimTimeseriesRead,
    evaluation_analytics_rollup: evalRollupTimeseriesRead,
    evaluation_analytics: evalSlimTimeseriesRead,
  };

type TimeseriesReader = (read: TimeseriesRead) => ReaderReadStatement;
/** How a query is read: a built read, or main's text while its shape is not ported yet. */
type TimeseriesRoute = { kind: "built"; read: TimeseriesReader } | { kind: "text" };

function routeOf({
  table,
  input,
}: {
  table: AnalyticsTable;
  input: TimeseriesQueryInput;
}): TimeseriesRoute {
  const built = (read: TimeseriesReader | undefined): TimeseriesRoute =>
    read ? { kind: "built", read } : { kind: "text" };
  if (table !== "trace_summaries") return built(BUILT_READS[table]);
  if (servesStandardTraceSummaries(input)) return built(traceSummariesTimeseriesRead);
  if (servesMixedEval(input)) return built(mixedEvalTimeseriesRead);
  if (servesJoinedTraceSummaries(input)) return built(joinedTimeseriesRead);
  if (servesSpanGrouped(input)) return built(spanGroupedTimeseriesRead);
  return { kind: "text" };
}

/** What an analytics statement is sent through: the fenced reader. */
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
    /** The routed client the fenced reads go through; the proof picks their tenants. */
    clickhouse: ClickHouseQueryClient;
  }): ClickHouseAnalyticsRepository {
    return new ClickHouseAnalyticsRepository(
      new AuthorizedClickHouse({ resolveClient: () => Promise.resolve(options.clickhouse) }),
      options.clickhouse,
    );
  }

  private readonly logger = createLogger("langwatch:analytics:timeseries-repository");

  private constructor(
    private readonly authorized: AuthorizedClickHouse,
    private readonly clickhouse: Pick<ClickHouseQueryClient, "read">,
  ) {
    super();
  }

  tableFor(input: AnalyticsTimeseriesInput, scope?: AnalyticsTableReadScope): AnalyticsTable {
    return pickAnalyticsTable(input, scope);
  }

  async runTimeseries(query: AnalyticsTimeseriesQuery): Promise<AnalyticsTimeseriesResult> {
    const projectId = query.input.projectId;
    if (!projectId.trim()) {
      throw new Error("Analytics timeseries projectId is required");
    }
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
    const limits: Record<string, string> =
      query.maxResultRows === undefined
        ? {}
        : { max_result_rows: String(query.maxResultRows), result_overflow_mode: "throw" };

    const route = routeOf({ table: query.table, input: builderInput });

    try {
      const rows =
        route.kind === "built"
          ? await this.sent(
              route.read({
                scope: this.proofScope({ authorization: query.authorization, projectId }),
                input: builderInput,
                settings: { ...ANALYTICS_CLICKHOUSE_SETTINGS, ...limits },
              }),
            )
          : await this.legacyRows({ query, builderInput, limits });
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
    const statement = topDocumentsRead(this.costRead(input));
    try {
      const topDocs = (await this.sent(statement)) as {
        documentId: string;
        count: string | number;
        trace_id: string;
        content?: string;
        total: string | number;
      }[];
      // Every row carries the distinct-document total; no rows means none.
      const total = topDocs[0]?.total ?? 0;
      return {
        topDocuments: topDocs.map((doc) => ({
          documentId: doc.documentId,
          count: typeof doc.count === "string" ? parseInt(doc.count, 10) : doc.count,
          traceId: doc.trace_id,
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
    const statement = feedbacksRead(this.costRead(input));
    try {
      const rows = (await this.sent(statement)) as {
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
    const statement = feedbacksPageRead({
      ...this.costRead(input),
      ...(input.after ? { after: input.after } : {}),
      limit: input.limit,
    });
    try {
      const fetched = feedbackPageRowsSchema.parse(await this.sent(statement));
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

  /** The trace_summaries / evaluation_runs text read, through the fenced reader. */
  private async legacyRows({
    query,
    builderInput,
    limits,
  }: {
    query: AnalyticsTimeseriesQuery;
    builderInput: TimeseriesQueryInput;
    limits: Record<string, string>;
  }): Promise<unknown> {
    const client = this.statementClient({
      authorization: query.authorization,
      projectId: builderInput.projectId,
      reads: "analytics",
    });
    const built = buildTimeseriesQuery(builderInput);
    const response = await client.query({
      query: built.sql,
      query_params: built.params,
      format: "JSONEachRow",
      clickhouse_settings: {
        ...ANALYTICS_CLICKHOUSE_SETTINGS,
        log_comment: `analytics:timeseries:${query.table}`,
        ...limits,
      },
    });
    return response.json();
  }

  /** An analytics proof scope; the proof must be for the input's project. */
  private proofScope({
    authorization,
    projectId,
  }: {
    authorization: Authorization;
    projectId: string;
  }): ProofScope {
    const scope = tenantScope.fromProof({ authorization, reads: "analytics" });
    if (!scope.fence.own.includes(projectId)) {
      throw new AnalyticsProofProjectMismatchError(projectId);
    }
    return scope;
  }

  /**
   * A cost read's scope, window and filters. The proof must be for the input's project, so a
   * read cannot be asked under one project and run under another's.
   */
  private costRead(input: AnalyticsLegacyReadInput) {
    const scope = tenantScope.fromProof({ authorization: input.authorization, reads: "cost" });
    if (!scope.fence.own.includes(input.projectId)) {
      throw new AnalyticsProofProjectMismatchError(input.projectId);
    }
    return {
      scope,
      window: { startMs: input.startDate, endMs: input.endDate },
      filters: input.filters,
    };
  }

  /** A built read's rows, its failures translated as the session translates them (ADR-045). */
  private async sent(statement: ReaderReadStatement): Promise<unknown[]> {
    const { rows } = await translatingQueryFailures(() => this.clickhouse.read({ statement }));
    return rows;
  }

  /**
   * The fenced reader a statement is sent through. The proof must be for the input's project,
   * so a read cannot be asked under one project and run under another's.
   */
  private statementClient({
    authorization,
    projectId,
    reads,
  }: {
    authorization: Authorization;
    projectId: string;
    reads: "analytics" | "cost";
  }): TimeseriesStatementClient {
    const reader = this.authorized.as(authorization, { reads });
    if (!reader.fence.own.includes(projectId)) {
      throw new AnalyticsProofProjectMismatchError(projectId);
    }
    return translatingFailures(reader);
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
