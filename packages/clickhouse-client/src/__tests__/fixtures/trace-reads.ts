/**
 * Trace's session, instant-eval, evaluation-run and braid reads, built with the typed builder.
 * The builder unit suite and the 26.8 row suite (trace-reads.integration.test.ts) share them.
 */
import type { CompiledWhere } from "@langwatch/authorization";

import { braidCondition } from "../../builder/braid-condition.ts";
import { column, cond, param } from "../../builder/expression.ts";
import { fn } from "../../builder/functions.ts";
import { clickhouseRead } from "../../builder/read.ts";
import { type ReaderScope } from "../../builder/scope.ts";
import { defineClickHouseTable } from "../../builder/table.ts";

export const summaries = defineClickHouseTable({
  name: "trace_summaries",
  tenantColumn: "TenantId",
  timeColumn: "OccurredAt",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "TraceId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    OccurredAt: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
    TotalCost: column.float64(),
    Attributes: column.stringMap(),
  },
});

export const logRecords = defineClickHouseTable({
  name: "log_records",
  tenantColumn: "TenantId",
  sortKey: ["TenantId", "TimeUnixMs"],
  columns: {
    TenantId: column.string(),
    TimeUnixMs: column.dateTime64({ precision: 3 }),
    ProviderSessionId: column.string(),
    BodyText: column.nullable(column.string()),
  },
});

export const instantEvalRuns = defineClickHouseTable({
  name: "instant_eval_runs",
  tenantColumn: "TenantId",
  versionColumn: "WrittenAt",
  sortKey: ["TenantId", "RunId"],
  columns: {
    TenantId: column.string(),
    RunId: column.string(),
    CreatedAt: column.dateTime64({ precision: 3 }),
    FinishedAt: column.nullable(column.dateTime64({ precision: 3 })),
    WrittenAt: column.dateTime64({ precision: 3 }),
    AcceptedAt: column.nullable(column.dateTime64({ precision: 3 })),
    LastEventId: column.string(),
  },
});

export const evaluationRuns = defineClickHouseTable({
  name: "evaluation_runs",
  tenantColumn: "TenantId",
  timeColumn: "ScheduledAt",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "EvaluationId"],
  columns: {
    TenantId: column.string(),
    EvaluationId: column.string(),
    TraceId: column.string(),
    ScheduledAt: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
    Attempts: column.uint16(),
    LastAttemptAt: column.nullable(column.dateTime64({ precision: 3 })),
  },
});

const conversationOf = () => fn.mapGet(summaries.Attributes, "gen_ai.conversation.id");

/** session-groups' count: `uniqExact(TenantId, <conversation>)` over the latest versions. */
export const sessionCountRead = ({ scope }: { scope: ReaderScope }) =>
  clickhouseRead({ scope })
    .from(summaries)
    .select({ totalHits: fn.uniqExact(summaries.TenantId, conversationOf()) })
    .where(({ ne }) => ne(conversationOf(), ""))
    .latestVersion()
    .build();

/** A page cursor over the rollup: the sort value an aggregate, ties broken on the group keys. */
export type SessionCursor = { sortValue: number; conversationId: string; tenantId: string };

/** session-groups' rollup page: the keyset over aggregates in HAVING. */
export const sessionPageRead = ({
  scope,
  cursor,
  limit,
}: {
  scope: ReaderScope;
  cursor: SessionCursor | undefined;
  limit: number;
}) => {
  const cost = () => fn.sum(summaries.TotalCost);
  const read = clickhouseRead({ scope })
    .from(summaries)
    .select({
      TenantId: summaries.TenantId,
      ConversationId: conversationOf(),
      TraceCount: fn.count(),
      SessionCost: cost(),
    })
    .where(({ ne }) => ne(conversationOf(), ""))
    .latestVersion()
    .groupBy(summaries.TenantId, conversationOf());
  const paged =
    cursor === undefined
      ? read
      : read.having(({ and, eq, gt, lt, or }) =>
          or(
            lt(cost(), param.float64(cursor.sortValue)),
            and(
              eq(cost(), param.float64(cursor.sortValue)),
              gt(
                fn.tuple(conversationOf(), summaries.TenantId),
                fn.tuple(param.string(cursor.conversationId), param.string(cursor.tenantId)),
              ),
            ),
          ),
        );
  return paged
    .orderBy(cost(), "DESC")
    .orderBy("ConversationId", "ASC")
    .orderBy("TenantId", "ASC")
    .limit(limit)
    .build();
};

/**
 * session-groups' membership: sessions with a trace matching a condition, or a log holding the
 * term. Main's `IN (a UNION DISTINCT b)` is `IN a OR IN b`: one CTE per branch.
 */
export const sessionMembersRead = ({
  scope,
  minCost,
  term,
}: {
  scope: ReaderScope;
  minCost: number;
  term: string;
}) =>
  clickhouseRead({ scope })
    .from(summaries)
    .with("traceMembers", (sub) =>
      sub
        .from(summaries)
        .select({ TenantId: summaries.TenantId, SessionId: conversationOf() })
        .distinct()
        .where(({ and, gte, ne }) =>
          and(ne(conversationOf(), ""), gte(summaries.TotalCost, minCost)),
        )
        .latestVersion(),
    )
    .with("logMembers", (sub) =>
      sub
        .from(logRecords)
        .select({ TenantId: logRecords.TenantId, SessionId: logRecords.ProviderSessionId })
        .distinct()
        .where(({ and, gt, ne }) =>
          and(
            ne(logRecords.ProviderSessionId, ""),
            gt(fn.positionCaseInsensitive(fn.ifNull(logRecords.BodyText, ""), term), 0),
          ),
        ),
    )
    .select({ TraceId: summaries.TraceId })
    .where(({ and, ne, oneOf, or }) =>
      and(
        ne(conversationOf(), ""),
        or(
          oneOf(fn.tuple(summaries.TenantId, conversationOf()), { cte: "traceMembers" }),
          oneOf(fn.tuple(summaries.TenantId, conversationOf()), { cte: "logMembers" }),
        ),
      ),
    )
    .latestVersion()
    .build();

/** instant-eval's run dating: an election on a tuple version, one row per run. */
export const instantEvalRunsRead = ({
  scope,
  runIds,
}: {
  scope: ReaderScope;
  runIds: readonly string[];
}) =>
  clickhouseRead({ scope })
    .from(instantEvalRuns)
    .select({
      RunId: instantEvalRuns.RunId,
      CreatedAtMs: fn.toUnixTimestamp64Milli(instantEvalRuns.CreatedAt),
      FinishedAtMs: fn.toUnixTimestamp64Milli(instantEvalRuns.FinishedAt),
    })
    .where(({ oneOf }) => oneOf(instantEvalRuns.RunId, [...new Set(runIds)]))
    .latestVersion({
      version: fn.tuple(
        instantEvalRuns.WrittenAt,
        fn.ifNull(instantEvalRuns.AcceptedAt, fn.toDateTime64(param.uint32(0), 3)),
        instantEvalRuns.LastEventId,
      ),
    })
    .limitBy(1, instantEvalRuns.RunId)
    .build();

/** evaluation-runs' attempts: the columns the target holds, the rest as defaults, last 7 days. */
export const evaluationAttemptsRead = ({
  scope,
  traceId,
  holds,
}: {
  scope: ReaderScope;
  traceId: string;
  holds: (name: string) => boolean;
}) =>
  clickhouseRead({ scope })
    .from(evaluationRuns)
    .select({
      EvaluationId: evaluationRuns.EvaluationId,
      AttemptCount: fn.heldOr(evaluationRuns.Attempts, {
        holds,
        otherwise: fn.toUInt16(param.uint16(0)),
      }),
      LastAttemptAtMs: fn.toUnixTimestamp64Milli(
        fn.heldOr(evaluationRuns.LastAttemptAt, {
          holds,
          otherwise: fn.nullAs(column.nullable(column.dateTime64({ precision: 3 }))),
        }),
      ),
    })
    // Two conditions, so the election repeats both, as main's dedup does.
    .where(({ gte }) => gte(evaluationRuns.ScheduledAt, fn.subtractDays(fn.now(), 7)))
    .where(({ eq }) => eq(evaluationRuns.TraceId, traceId))
    .latestVersion({ repeat: [evaluationRuns.TraceId] })
    .orderBy(evaluationRuns.UpdatedAt, "DESC")
    .build();

export const spans = defineClickHouseTable({
  name: "stored_spans",
  tenantColumn: "TenantId",
  timeColumn: "StartTime",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "TraceId", "SpanId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    SpanId: column.string(),
    SpanName: column.string(),
    StartTime: column.dateTime64({ precision: 9 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
    SpanAttributes: column.stringMap(),
    ResourceAttributes: column.stringMap(),
  },
});

/** A braid as the activity reads take it: its condition, its reader and its window. */
export type BraidRead = {
  compiledWhere: CompiledWhere;
  reader: string;
  fromMs: number;
  untilMs: number;
};

/**
 * trace braid's owner activity: per span, whether each braid shows its latest version, as
 * `argMax(<window AND condition>, UpdatedAt)`; then the spans each braid shows.
 */
export const braidActivityRead = ({
  scope,
  braids,
  sinceMs,
}: {
  scope: ReaderScope;
  braids: readonly [BraidRead, BraidRead];
  sinceMs: number;
}) => {
  const shows = (braid: BraidRead) =>
    fn.argMax(
      cond.and(
        cond.gte(spans.StartTime, braid.fromMs),
        cond.lt(spans.StartTime, braid.untilMs),
        braidCondition(spans, braid),
      ),
      spans.UpdatedAt,
    );
  const perSpan = clickhouseRead({ scope })
    .from(spans)
    .select({ a0: shows(braids[0]), a1: shows(braids[1]) })
    .where(({ gte }) => gte(spans.StartTime, sinceMs))
    .groupBy(spans.TraceId, spans.SpanId)
    .as("perSpan");
  return clickhouseRead({ scope })
    .from(perSpan)
    .select({ a0: fn.countIf(perSpan.a0), a1: fn.countIf(perSpan.a1) })
    .build();
};

/** A braid condition, negated and ORed, as a plain where term over the latest span versions. */
export const braidMarkedRead = ({
  scope,
  braid,
  traceId,
}: {
  scope: ReaderScope;
  braid: BraidRead;
  traceId: string;
}) =>
  clickhouseRead({ scope })
    .from(spans)
    .select({ SpanId: spans.SpanId, Braided: braidCondition(spans, braid) })
    .where(({ eq }) => eq(spans.TraceId, traceId))
    .latestVersion()
    .build();

/**
 * trace braid's attribute keys: main's `ARRAY JOIN mapKeys(…)` over a sample is `arrayJoin` in a
 * derived read of the sample, so the key filter reads the joined key once.
 */
export const attributeKeysRead = ({
  scope,
  sinceMs,
  sampleRows,
  excludedPrefix,
  limit,
}: {
  scope: ReaderScope;
  sinceMs: number;
  sampleRows: number;
  excludedPrefix: string;
  limit: number;
}) => {
  const sampled = clickhouseRead({ scope })
    .from(spans)
    .select({ SpanAttributes: spans.SpanAttributes })
    .where(({ gte }) => gte(spans.StartTime, sinceMs))
    .limit(sampleRows)
    .as("sampled");
  const keys = clickhouseRead({ scope })
    .from(sampled)
    .select({ key: fn.arrayJoin(fn.mapKeys(sampled.SpanAttributes)) })
    .as("keys");
  return clickhouseRead({ scope })
    .from(keys)
    .select({ key: keys.key, spanCount: fn.count() })
    .where(({ not }) => not(fn.startsWith(keys.key, excludedPrefix)))
    .groupBy(keys.key)
    .orderBy("spanCount", "DESC")
    .orderBy("key", "ASC")
    .limit(limit)
    .build();
};
