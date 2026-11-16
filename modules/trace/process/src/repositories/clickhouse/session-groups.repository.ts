import type { Authorization } from "@langwatch/authorization";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  type ClickHouseReadStart,
  clickhouseRead,
  type Condition,
  cond,
  type Expression,
  fn,
  param,
  type ProofScope,
  tenantScope as builtTenantScope,
} from "@langwatch/clickhouse-client/builder";
import {
  RESERVED_CACHE_CREATION_TOKENS,
  RESERVED_CACHE_READ_TOKENS,
} from "@langwatch/trace-contract";
import { z } from "zod";

import type { TraceFilterCompilation } from "../../features/query/repositories/clickhouse/clickhouse.trace-filter-condition.mapper.ts";
import type {
  SessionGroupCursor,
  SessionGroupRow,
  SessionGroupSortColumn,
  SessionGroupsPage,
  SessionGroupsQuery,
  SessionGroupsRepository,
} from "../session-groups.repository.ts";
import { logRecords } from "./clickhouse.log-records.table.ts";
import { traceSummaries as ts } from "./clickhouse.trace-summaries.table.ts";
import { electedSummaries, isLiveUpperBound } from "./clickhouse.trace-summary-election.mapper.ts";
import { chString } from "./stored-span-row.mapper.ts";

const attribute = (key: string) => fn.mapGet(ts.Attributes, key);

/**
 * The grouping key. Session id == conversation id: coding agents stamp their
 * provider session id on `gen_ai.conversation.id`, and chat apps stamp their
 * thread id, either way this expression IS the session identity.
 */
const CONVERSATION_ID = attribute("gen_ai.conversation.id");

/** Buffer for content-search pruning around the trace time range. */
const LOG_WINDOW_BUFFER_MS = 2 * 24 * 60 * 60 * 1000;

/** Bound on the distinct models kept per session row. */
const MODELS_PER_SESSION_LIMIT = 20;

/** A trace's tokens: input, output and both cache buckets (`traceTotalTokensOf`). */
const TOTAL_TOKENS = fn.plus(
  fn.plus(
    fn.plus(fn.ifNull(ts.TotalPromptTokenCount, 0), fn.ifNull(ts.TotalCompletionTokenCount, 0)),
    fn.toUInt64OrZero(attribute(RESERVED_CACHE_READ_TOKENS)),
  ),
  fn.toUInt64OrZero(attribute(RESERVED_CACHE_CREATION_TOKENS)),
);

const OCCURRED_MS = fn.toUnixTimestamp64Milli(ts.OccurredAt);

/** Aggregate expressions per sortable dimension, rounded for keyset pagination. */
const SORT_EXPRESSIONS: Record<SessionGroupSortColumn, Expression<number, "trace_summaries">> = {
  lastActivity: fn.toFloat64(fn.max(OCCURRED_MS)),
  started: fn.toFloat64(fn.min(OCCURRED_MS)),
  cost: fn.round(fn.sum(fn.ifNull(ts.TotalCost, 0)), 9),
  tokens: fn.toFloat64(fn.sum(TOTAL_TOKENS)),
  duration: fn.round(fn.sum(fn.ifNull(ts.TotalDurationMs, 0)), 6),
  traces: fn.toFloat64(fn.count()),
};

// Aggregate aliases avoid every source column name: ClickHouse resolves a same-named alias
// INSTEAD of the column inside sibling aggregates (and the builder refuses one).
const SESSION_SELECTION = {
  TenantId: ts.TenantId,
  ConversationId: CONVERSATION_ID,
  TraceCount: fn.count(),
  SessionCost: SORT_EXPRESSIONS.cost,
  SessionTokens: fn.sum(TOTAL_TOKENS),
  SessionCacheReadTokens: fn.sum(fn.toUInt64OrZero(attribute(RESERVED_CACHE_READ_TOKENS))),
  SessionCacheCreationTokens: fn.sum(fn.toUInt64OrZero(attribute(RESERVED_CACHE_CREATION_TOKENS))),
  MaxContextSizeTokens: fn.max(
    fn.toUInt64OrZero(attribute("langwatch.reserved.context_size_tokens")),
  ),
  SessionDurationMs: SORT_EXPRESSIONS.duration,
  StartedAtMs: fn.min(OCCURRED_MS),
  LastActivityMs: fn.max(OCCURRED_MS),
  SessionModels: fn.groupUniqArrayArray(ts.Models, { max: MODELS_PER_SESSION_LIMIT }),
  PrimaryModels: fn.topKArray(1, ts.Models),
  SessionServices: fn.groupUniqArrayIf(
    attribute("service.name"),
    cond.ne(attribute("service.name"), ""),
    { max: 2 },
  ),
  SessionErrorCount: fn.countIf(cond.eq(ts.ContainsErrorStatus, true)),
  SessionWarningCount: fn.countIf(
    cond.and(cond.eq(ts.BlockedByGuardrail, true), cond.eq(ts.ContainsErrorStatus, false)),
  ),
  SessionSpans: fn.sum(ts.SpanCount),
  /** The session's latest trace, in the session's own tenant (`TenantId`, a grouping key). */
  LastTraceId: fn.argMax(ts.TraceId, fn.tuple(ts.OccurredAt, ts.UpdatedAt)),
};

const numeric = z.union([z.number(), z.string()]);

const sessionGroupRowSchema = z.looseObject({
  TenantId: chString,
  ConversationId: chString,
  TraceCount: numeric,
  SessionCost: numeric,
  SessionTokens: numeric,
  SessionCacheReadTokens: numeric,
  SessionCacheCreationTokens: numeric,
  MaxContextSizeTokens: numeric,
  SessionDurationMs: numeric,
  StartedAtMs: numeric,
  LastActivityMs: numeric,
  SessionModels: z.array(chString),
  PrimaryModels: z.array(chString),
  SessionServices: z.array(chString),
  SessionErrorCount: numeric,
  SessionWarningCount: numeric,
  SessionSpans: numeric,
  LastTraceId: chString,
});

const sessionGroupRowsSchema = z.array(sessionGroupRowSchema);

type ClickHouseSessionGroupRow = z.infer<typeof sessionGroupRowSchema>;

const totalHitsRowsSchema = z.array(z.looseObject({ totalHits: numeric }));

const previewRowSchema = z.looseObject({
  TenantId: chString,
  TraceId: chString,
  ComputedInput: chString.nullable(),
  ComputedOutput: chString.nullable(),
});

const previewRowsSchema = z.array(previewRowSchema);

/** A trace's previews key: the id alone is not unique across the tenants an aggregate reads. */
function previewKey({ TenantId, TraceId }: { TenantId: string; TraceId: string }): string {
  return `${TenantId}:${TraceId}`;
}

const NO_FILTER: TraceFilterCompilation = { kind: "empty" };

/**
 * The window's latest traces that carry a conversation id. The empty-id check sits outside the
 * election, as main's did, so the election sees every version in the window.
 */
function sessionTraces({
  start,
  timeRange,
  filter,
}: {
  start: ClickHouseReadStart<ProofScope>;
  timeRange: SessionGroupsQuery["timeRange"];
  filter: TraceFilterCompilation;
}) {
  return electedSummaries({ start, timeRange, filter }).where(() => cond.ne(CONVERSATION_ID, ""), {
    inElection: false,
  });
}

/** Log lines inside the buffered range holding every term; a share reads only its windows. */
function logMatchCondition({
  timeRange,
  terms,
}: {
  timeRange: SessionGroupsQuery["timeRange"];
  terms: readonly string[];
}): Condition<"log_records"> {
  const lr = logRecords;
  // TimeUnixMs bounds prune log_records' weekly partitions; a live range keeps the lower one.
  const from = cond.gte(lr.TimeUnixMs, timeRange.from - LOG_WINDOW_BUFFER_MS);
  const range = isLiveUpperBound(timeRange)
    ? from
    : cond.and(from, cond.lte(lr.TimeUnixMs, timeRange.to + LOG_WINDOW_BUFFER_MS));
  const matches = terms.map((term) =>
    cond.or(
      cond.gt(fn.positionCaseInsensitive(fn.ifNull(lr.BodyText, ""), param.string(term)), 0),
      cond.gt(fn.positionCaseInsensitive(lr.AttributesFlatJson, param.string(term)), 0),
    ),
  );
  return cond.and(range, cond.ne(lr.ProviderSessionId, ""), ...matches);
}

/** Sessions past the cursor; (conversation, tenant) breaks ties, older cursors the id alone. */
function pastCursor({
  sort,
  ascending,
  cursor,
}: {
  sort: Expression<number, "trace_summaries">;
  ascending: boolean;
  cursor: SessionGroupCursor;
}): Condition<"trace_summaries"> {
  const value = param.float64(cursor.sortValue);
  const beyond = ascending ? cond.gt(sort, value) : cond.lt(sort, value);
  const tie =
    cursor.tenantId === undefined
      ? cond.gt(CONVERSATION_ID, param.string(cursor.conversationId))
      : cond.gt(
          fn.tuple(CONVERSATION_ID, ts.TenantId),
          fn.tuple(param.string(cursor.conversationId), param.string(cursor.tenantId)),
        );
  return cond.or(beyond, cond.and(cond.eq(sort, value), tie));
}

/**
 * The window's sessions as the read's proof scope sees them. A session is in when any of its
 * latest traces matches the filter or a log line holds every content term (either branch).
 */
function sessionsOf(query: SessionGroupsQuery) {
  const scope = builtTenantScope.fromProof({ authorization: query.authorization, reads: "traces" });
  const filter = query.compileFilter?.({ scope }) ?? NO_FILTER;
  const terms = (query.contentTerms ?? []).filter((term) => term.length > 0);
  const read = sessionTraces({
    start: clickhouseRead({ scope }),
    timeRange: query.timeRange,
    filter: NO_FILTER,
  });
  if (filter.kind === "empty" && terms.length === 0) return read;
  const session = fn.tuple(ts.TenantId, CONVERSATION_ID);
  return read.where(
    ({ within }) => {
      const byFilter =
        filter.kind === "compiled"
          ? within(session, (sub) =>
              sessionTraces({ start: sub, timeRange: query.timeRange, filter })
                .select({ TenantId: ts.TenantId, SessionId: CONVERSATION_ID })
                .latestVersion(),
            )
          : undefined;
      const byLog =
        terms.length > 0
          ? within(session, (sub) =>
              sub
                .from(logRecords)
                .withinWindows()
                .select({ TenantId: logRecords.TenantId, SessionId: logRecords.ProviderSessionId })
                .where(() => logMatchCondition({ timeRange: query.timeRange, terms })),
            )
          : undefined;
      if (byFilter && byLog) return cond.or(byFilter, byLog);
      return byFilter ?? byLog ?? cond.always();
    },
    { inElection: false },
  );
}

/** One page of sessions, sorted and keyset-paged over the grouped rows. */
function sessionPageStatement(query: SessionGroupsQuery) {
  const sort = SORT_EXPRESSIONS[query.sort.column];
  const ascending = query.sort.direction === "asc";
  const grouped = sessionsOf(query)
    .select(SESSION_SELECTION)
    .latestVersion()
    .groupBy(ts.TenantId, CONVERSATION_ID);
  const { cursor } = query;
  const paged =
    cursor === undefined ? grouped : grouped.having(() => pastCursor({ sort, ascending, cursor }));
  return paged
    .orderBy(sort, ascending ? "ASC" : "DESC")
    .orderBy(CONVERSATION_ID, "ASC")
    .orderBy(ts.TenantId, "ASC")
    .limit(query.limit)
    .build();
}

/** The sessions the page is drawn from, counted. */
function sessionCountStatement(query: SessionGroupsQuery) {
  return sessionsOf(query)
    .select({ totalHits: fn.uniqExact(ts.TenantId, CONVERSATION_ID) })
    .latestVersion()
    .build();
}

/**
 * The latest version of each of a page's traces, under the proof's windowed fence. The page's
 * time range bounds the election too, as the rollup's does.
 */
function previewsStatement({
  authorization,
  timeRange,
  traceIds,
}: {
  authorization: Authorization;
  timeRange: { from: number; to: number; live?: boolean };
  traceIds: readonly string[];
}) {
  return clickhouseRead({
    scope: builtTenantScope.fromProof({ authorization, reads: "traces" }),
  })
    .from(ts)
    .withinWindows()
    .select({
      TenantId: ts.TenantId,
      TraceId: ts.TraceId,
      ComputedInput: ts.ComputedInput,
      ComputedOutput: ts.ComputedOutput,
    })
    .where(({ and, gte, lte, oneOf }) =>
      isLiveUpperBound(timeRange)
        ? and(gte(ts.OccurredAt, timeRange.from), oneOf(ts.TraceId, traceIds))
        : and(
            gte(ts.OccurredAt, timeRange.from),
            lte(ts.OccurredAt, timeRange.to),
            oneOf(ts.TraceId, traceIds),
          ),
    )
    .latestVersion()
    .build();
}

export class SessionGroupsClickHouseRepository implements SessionGroupsRepository {
  static create(deps: {
    reader: Pick<ClickHouseQueryClient, "read">;
  }): SessionGroupsClickHouseRepository {
    return new SessionGroupsClickHouseRepository(deps);
  }

  private constructor(
    private readonly deps: {
      reader: Pick<ClickHouseQueryClient, "read">;
    },
  ) {}

  async listSessionGroups(query: SessionGroupsQuery): Promise<SessionGroupsPage> {
    // Phase 1: the rollup itself, light columns only. Heavy previews are read in phase 2 for
    // the page's latest trace ids alone, mirroring the trace list's two-step read.
    const [result, countResult] = await Promise.all([
      this.deps.reader.read({
        // ID_BOUND_SKIP: one page of the window's sessions, bounded by OccurredAt.
        statement: sessionPageStatement(query),
        table: ts.$table.name,
      }),
      this.deps.reader.read({
        // ID_BOUND_SKIP: the window's session count, bounded by OccurredAt.
        statement: sessionCountStatement(query),
        table: ts.$table.name,
      }),
    ]);

    const rows = sessionGroupRowsSchema.parse(result.rows);
    const countRows = totalHitsRowsSchema.parse(countResult.rows);
    const totalHits = countRows.length > 0 ? Number(countRows[0]!.totalHits) : 0;

    const previews = await this.findPreviewsByTraceIds({
      authorization: query.authorization,
      timeRange: query.timeRange,
      traceIds: rows.map((row) => row.LastTraceId).filter(Boolean),
    });

    return {
      rows: rows.map((row) => this.toSessionGroupRow(row, previews)),
      totalHits,
    };
  }

  /**
   * Phase 2: computed I/O previews for the page's latest trace per session.
   * Bounded to at most one trace per returned row, so the heavy columns never
   * ride through the rollup scan.
   */
  private async findPreviewsByTraceIds(args: {
    authorization: Authorization;
    timeRange: { from: number; to: number; live?: boolean };
    traceIds: string[];
  }): Promise<Map<string, { input: string | null; output: string | null }>> {
    // Keyed by tenant and trace id: the ids are read across every tenant the
    // proof fences, and two of those may hold the same id (ADR-177).
    const previews = new Map<string, { input: string | null; output: string | null }>();
    if (args.traceIds.length === 0) return previews;

    const result = await this.deps.reader.read({
      // ID_BOUND_SKIP: a page's previews, bounded by the page's time range.
      statement: previewsStatement(args),
      table: ts.$table.name,
    });

    const rows = previewRowsSchema.parse(result.rows);
    for (const row of rows) {
      previews.set(previewKey(row), {
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
    const preview = previews.get(previewKey({ TenantId: row.TenantId, TraceId: row.LastTraceId }));
    return {
      conversationId: row.ConversationId,
      tenantId: row.TenantId,
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
      lastTraceId: row.LastTraceId,
      input: preview?.input ?? null,
      output: preview?.output ?? null,
    };
  }
}
