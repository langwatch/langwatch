import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import type {
  SessionGroupRow,
  SessionGroupSortColumn,
  SessionGroupsPage,
  SessionGroupsQuery,
  SessionGroupsRepository,
} from "./session-groups.repository";

const TABLE_NAME = "trace_summaries" as const;

/**
 * The grouping key. Session id == conversation id: coding agents stamp their
 * provider session id on `gen_ai.conversation.id`, and chat apps stamp their
 * thread id, either way this expression IS the session identity.
 */
const CONVERSATION_ID_EXPR = "Attributes['gen_ai.conversation.id']" as const;

/**
 * Buffer applied around the trace time range when bounding the `log_records`
 * content-search subquery. Log records land around their session's trace
 * activity, so +/- 2 days guarantees a matching record near the boundary is
 * never pruned away. Matches the span-pruning margin used by the trace list.
 */
const LOG_WINDOW_BUFFER_MS = 2 * 24 * 60 * 60 * 1000;

/** Bound on the distinct models kept per session row. */
const MODELS_PER_SESSION_LIMIT = 20;

/**
 * Aggregate expressions per sortable dimension. Float aggregates are rounded
 * IN SQL so the value we hand back as a cursor and the value the next page's
 * HAVING recomputes are bit-identical, parallel Float64 summation is not
 * deterministic at full precision, and an unrounded sum can wobble past the
 * keyset boundary between requests, duplicating or skipping a row.
 */
const SORT_EXPRESSIONS: Record<SessionGroupSortColumn, string> = {
  lastActivity: "toFloat64(max(toUnixTimestamp64Milli(OccurredAt)))",
  started: "toFloat64(min(toUnixTimestamp64Milli(OccurredAt)))",
  cost: "round(sum(coalesce(TotalCost, 0)), 9)",
  tokens:
    "toFloat64(sum(coalesce(TotalPromptTokenCount, 0) + coalesce(TotalCompletionTokenCount, 0)))",
  duration: "round(sum(coalesce(TotalDurationMs, 0)), 6)",
  traces: "toFloat64(count())",
};

// Aggregate aliases deliberately avoid every source column name (Models,
// TotalCost, TotalDurationMs, ...): ClickHouse resolves a same-named alias
// INSTEAD of the column inside sibling aggregates, which reads as an
// aggregate nested in an aggregate and fails the whole query.
interface ClickHouseSessionGroupRow {
  ConversationId: string;
  TraceCount: number | string;
  SessionCost: number | string;
  SessionTokens: number | string;
  SessionCacheReadTokens: number | string;
  SessionCacheCreationTokens: number | string;
  MaxContextSizeTokens: number | string;
  SessionDurationMs: number | string;
  StartedAtMs: number | string;
  LastActivityMs: number | string;
  SessionModels: string[];
  PrimaryModels: string[];
  SessionServices: string[];
  SessionErrorCount: number | string;
  SessionWarningCount: number | string;
  SessionSpans: number | string;
  LastTraceId: string;
}

function isLiveUpperBound(timeRange: { to: number; live?: boolean }): boolean {
  return timeRange.live === true;
}

function buildBaseWhere(
  tenantId: string,
  timeRange: { from: number; to: number; live?: boolean },
): { sql: string; params: Record<string, unknown> } {
  const parts = [
    "TenantId = {tenantId:String}",
    "OccurredAt >= fromUnixTimestamp64Milli({timeFrom:Int64})",
  ];
  const params: Record<string, unknown> = {
    tenantId,
    timeFrom: timeRange.from,
  };
  if (!isLiveUpperBound(timeRange)) {
    parts.push("OccurredAt <= fromUnixTimestamp64Milli({timeTo:Int64})");
    params.timeTo = timeRange.to;
  }
  return { sql: parts.join(" AND "), params };
}

export class SessionGroupsClickHouseRepository
  implements SessionGroupsRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async findSessionGroups(
    query: SessionGroupsQuery,
  ): Promise<SessionGroupsPage> {
    EventUtils.validateTenantId(
      { tenantId: query.tenantId },
      "SessionGroupsClickHouseRepository.findSessionGroups",
    );

    const { sql: baseWhere, params } = buildBaseWhere(
      query.tenantId,
      query.timeRange,
    );

    // Latest-version dedup, the rollup must sum each logical trace exactly
    // once even while ReplacingMergeTree merges lag. Same IN-tuple shape as
    // every other `trace_summaries` read.
    const dedupFilter = `(TenantId, TraceId, UpdatedAt) IN (
          SELECT TenantId, TraceId, max(UpdatedAt)
          FROM ${TABLE_NAME}
          WHERE ${baseWhere}
          GROUP BY TenantId, TraceId
        )`;

    const { sql: sessionMatchClause, params: matchParams } =
      this.buildSessionMatchClause(query, baseWhere);
    Object.assign(params, matchParams);

    const sortExpression = SORT_EXPRESSIONS[query.sort.column];
    const sortDir = query.sort.direction === "asc" ? "ASC" : "DESC";
    const cursorComparison = query.sort.direction === "asc" ? ">" : "<";
    // Keyset over the GROUP BY output lives in HAVING: the sort value is an
    // aggregate, so it does not exist before grouping. ConversationId ASC is
    // the unique tie-breaker regardless of sort direction, matching the trace
    // list's TraceId tie-break convention.
    const havingClause = query.cursor
      ? `HAVING (
              ${sortExpression} ${cursorComparison} {cursorSortValue:Float64}
              OR (
                ${sortExpression} = {cursorSortValue:Float64}
                AND ConversationId > {cursorConversationId:String}
              )
            )`
      : "";
    if (query.cursor) {
      params.cursorSortValue = query.cursor.sortValue;
      params.cursorConversationId = query.cursor.conversationId;
    }

    const client = await this.resolveClient(query.tenantId);

    // Phase 1: the rollup itself, light columns only. Heavy previews
    // (ComputedInput/ComputedOutput) are read in phase 2 for the page's
    // latest trace ids alone, mirroring the trace list's two-step read.
    const [result, countResult] = await Promise.all([
      client.query({
        query: `
        SELECT
          ${CONVERSATION_ID_EXPR} AS ConversationId,
          count() AS TraceCount,
          ${SORT_EXPRESSIONS.cost} AS SessionCost,
          sum(coalesce(TotalPromptTokenCount, 0) + coalesce(TotalCompletionTokenCount, 0)) AS SessionTokens,
          sum(toUInt64OrZero(Attributes['langwatch.reserved.cache_read_tokens'])) AS SessionCacheReadTokens,
          sum(toUInt64OrZero(Attributes['langwatch.reserved.cache_creation_tokens'])) AS SessionCacheCreationTokens,
          max(toUInt64OrZero(Attributes['langwatch.reserved.context_size_tokens'])) AS MaxContextSizeTokens,
          ${SORT_EXPRESSIONS.duration} AS SessionDurationMs,
          min(toUnixTimestamp64Milli(OccurredAt)) AS StartedAtMs,
          max(toUnixTimestamp64Milli(OccurredAt)) AS LastActivityMs,
          groupUniqArrayArray(${MODELS_PER_SESSION_LIMIT})(Models) AS SessionModels,
          topKArray(1)(Models) AS PrimaryModels,
          groupUniqArrayIf(2)(Attributes['service.name'], Attributes['service.name'] != '') AS SessionServices,
          countIf(ContainsErrorStatus) AS SessionErrorCount,
          countIf(BlockedByGuardrail AND NOT ContainsErrorStatus) AS SessionWarningCount,
          sum(SpanCount) AS SessionSpans,
          argMax(TraceId, (OccurredAt, UpdatedAt)) AS LastTraceId
        FROM ${TABLE_NAME}
        WHERE ${baseWhere}
          AND ${CONVERSATION_ID_EXPR} != ''
          AND ${dedupFilter}
          ${sessionMatchClause}
        GROUP BY ConversationId
        ${havingClause}
        ORDER BY ${sortExpression} ${sortDir}, ConversationId ASC
        LIMIT {limit:UInt32}
      `,
        query_params: { ...params, limit: query.limit },
        format: "JSONEachRow",
      }),
      client.query({
        query: `
        SELECT uniqExact(${CONVERSATION_ID_EXPR}) AS totalHits
        FROM ${TABLE_NAME}
        WHERE ${baseWhere}
          AND ${CONVERSATION_ID_EXPR} != ''
          AND ${dedupFilter}
          ${sessionMatchClause}
      `,
        query_params: { ...params },
        format: "JSONEachRow",
      }),
    ]);

    const rows = await result.json<ClickHouseSessionGroupRow>();
    const countRows = await countResult.json<{ totalHits: number | string }>();
    const totalHits =
      countRows.length > 0 ? Number(countRows[0]!.totalHits) : 0;

    const previews = await this.findPreviewsByTraceIds({
      tenantId: query.tenantId,
      timeRange: query.timeRange,
      traceIds: rows.map((row) => row.LastTraceId).filter(Boolean),
    });

    return {
      rows: rows.map((row) => this.toSessionGroupRow(row, previews)),
      totalHits,
    };
  }

  /**
   * Membership predicate for filtered reads. A session matches when any of
   * its traces matches the trace-level filter, OR when its transcript content
   * in `log_records` contains every free-text term. Applied as an IN over
   * session ids so the outer rollup still sums ALL traces of a matching
   * session, filtering rows before GROUP BY would truncate the totals to the
   * matching traces only, which is exactly the page-local bug this lens
   * replaces.
   */
  private buildSessionMatchClause(
    query: SessionGroupsQuery,
    baseWhere: string,
  ): { sql: string; params: Record<string, unknown> } {
    const branches: string[] = [];
    const params: Record<string, unknown> = {};

    if (query.filterWhere) {
      branches.push(`
            SELECT DISTINCT ${CONVERSATION_ID_EXPR} AS SessionId
            FROM ${TABLE_NAME}
            WHERE ${baseWhere}
              AND ${CONVERSATION_ID_EXPR} != ''
              AND (${query.filterWhere.sql})`);
      Object.assign(params, query.filterWhere.params);
    }

    const contentTerms = (query.contentTerms ?? []).filter(
      (term) => term.length > 0,
    );
    if (contentTerms.length > 0) {
      const termPredicates = contentTerms
        .map((term, index) => {
          const param = `contentTerm${index}`;
          params[param] = term;
          return `(positionCaseInsensitive(ifNull(BodyText, ''), {${param}:String}) > 0
                   OR positionCaseInsensitive(AttributesFlatJson, {${param}:String}) > 0)`;
        })
        .join(" AND ");
      // TimeUnixMs bounds are REQUIRED: log_records partitions weekly on it,
      // and without the range this subquery scans every partition including
      // cold storage. Live ranges keep only the lower bound, like the trace
      // scan itself.
      const upperBound = isLiveUpperBound(query.timeRange)
        ? ""
        : "AND TimeUnixMs <= fromUnixTimestamp64Milli({logTimeTo:Int64})";
      params.logTimeFrom = query.timeRange.from - LOG_WINDOW_BUFFER_MS;
      if (!isLiveUpperBound(query.timeRange)) {
        params.logTimeTo = query.timeRange.to + LOG_WINDOW_BUFFER_MS;
      }
      branches.push(`
            SELECT DISTINCT ProviderSessionId AS SessionId
            FROM log_records
            WHERE TenantId = {tenantId:String}
              AND TimeUnixMs >= fromUnixTimestamp64Milli({logTimeFrom:Int64})
              ${upperBound}
              AND ProviderSessionId != ''
              AND ${termPredicates}`);
    }

    if (branches.length === 0) return { sql: "", params };

    return {
      sql: `AND ${CONVERSATION_ID_EXPR} IN (${branches.join("\n            UNION DISTINCT\n")}
          )`,
      params,
    };
  }

  /**
   * Phase 2: computed I/O previews for the page's latest trace per session.
   * Bounded to at most one trace per returned row, so the heavy columns never
   * ride through the rollup scan.
   */
  private async findPreviewsByTraceIds(args: {
    tenantId: string;
    timeRange: { from: number; to: number; live?: boolean };
    traceIds: string[];
  }): Promise<Map<string, { input: string | null; output: string | null }>> {
    const previews = new Map<
      string,
      { input: string | null; output: string | null }
    >();
    if (args.traceIds.length === 0) return previews;

    const { sql: baseWhere, params } = buildBaseWhere(
      args.tenantId,
      args.timeRange,
    );

    const client = await this.resolveClient(args.tenantId);
    const result = await client.query({
      query: `
        SELECT TraceId, ComputedInput, ComputedOutput
        FROM ${TABLE_NAME}
        WHERE ${baseWhere}
          AND TraceId IN {previewTraceIds:Array(String)}
          AND (TenantId, TraceId, UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE ${baseWhere}
              AND TraceId IN {previewTraceIds:Array(String)}
            GROUP BY TenantId, TraceId
          )
      `,
      query_params: { ...params, previewTraceIds: args.traceIds },
      format: "JSONEachRow",
    });

    const rows = await result.json<{
      TraceId: string;
      ComputedInput: string | null;
      ComputedOutput: string | null;
    }>();
    for (const row of rows) {
      previews.set(row.TraceId, {
        input: row.ComputedInput ?? null,
        output: row.ComputedOutput ?? null,
      });
    }
    return previews;
  }

  private toSessionGroupRow(
    row: ClickHouseSessionGroupRow,
    previews: Map<string, { input: string | null; output: string | null }>,
  ): SessionGroupRow {
    const contextSize = Number(row.MaxContextSizeTokens);
    const services = row.SessionServices ?? [];
    const preview = previews.get(row.LastTraceId);
    return {
      conversationId: row.ConversationId,
      traceCount: Number(row.TraceCount),
      totalCost: Number(row.SessionCost),
      totalTokens: Number(row.SessionTokens),
      cacheReadTokens: Number(row.SessionCacheReadTokens),
      cacheCreationTokens: Number(row.SessionCacheCreationTokens),
      contextSizeTokens: contextSize > 0 ? contextSize : null,
      totalDurationMs: Number(row.SessionDurationMs),
      startedAtMs: Number(row.StartedAtMs),
      lastActivityMs: Number(row.LastActivityMs),
      models: row.SessionModels ?? [],
      primaryModel: row.PrimaryModels?.[0] ?? "",
      serviceName: services.length === 1 ? (services[0] ?? "") : "",
      errorCount: Number(row.SessionErrorCount),
      warningCount: Number(row.SessionWarningCount),
      totalSpans: Number(row.SessionSpans),
      input: preview?.input ?? null,
      output: preview?.output ?? null,
    };
  }
}
