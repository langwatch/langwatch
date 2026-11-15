import type { Authorization } from "@langwatch/authorization";
import {
  type AuthorizedClickHouse,
  type ClickHouseQueryClient,
  type TenantScopedReader,
  type TenantScopeTimeColumn,
  tenantScope,
} from "@langwatch/clickhouse-client";
import {
  type ClickHouseReadStart,
  type ClickHouseTable,
  clickhouseRead,
  type Condition,
  cond,
  type DerivedColumns,
  type Expression,
  fn,
  param,
  type ProofScope,
  type ReaderScope,
  tenantScope as builtTenantScope,
} from "@langwatch/clickhouse-client/builder";
import { nowInstant } from "@langwatch/time";
import {
  isStorageAnchoredVersion,
  RESERVED_CACHE_CREATION_TOKENS,
  RESERVED_CACHE_READ_TOKENS,
  type TraceListCursor,
  type TraceListFacetQuery,
  type TraceListRepositoryPage,
  type TraceListRow,
  type TraceListSortColumn,
  type TraceRef,
  type BatchedFacetResult,
  type CategoricalFacetResult,
  type DiscreteFacetResult,
  type FacetTableName,
  type EventMetricValues,
  EVENT_METRIC_SEP,
} from "@langwatch/trace-contract";
import { z } from "zod";

import { TRACE_SUMMARY_CATEGORICAL_EXPRESSIONS } from "../../features/facet/repositories/clickhouse/clickhouse.trace-facet-expressions.mapper.ts";
import { scopeTraceFilterToTable } from "../../features/facet/repositories/clickhouse/clickhouse.trace-facet-scope.mapper.ts";
import type {
  TraceFilterCompilation,
  TraceFilterCompile,
  TraceFilterCondition,
} from "../../features/query/repositories/clickhouse/clickhouse.trace-filter-condition.mapper.ts";
import type { TraceFilterWhere } from "../../rules/trace-filter-hidden-origins.rules.ts";
import type {
  TraceListQuery,
  TraceListRepository,
  TraceSuggestField,
} from "../trace-list.repository.ts";
import { storedSpans } from "./clickhouse.stored-spans.table.ts";
import { traceSummaries } from "./clickhouse.trace-summaries.table.ts";
import { chBoolean, chNumber, chString } from "./stored-span-row.mapper.ts";

const numeric = z.union([z.number(), z.string()]);
const flag = z.union([z.boolean(), z.number()]);

const totalHitsRowsSchema = z.array(z.looseObject({ totalHits: numeric }));

const countRowsSchema = z.array(z.looseObject({ cnt: numeric }));

const distinctValueRowsSchema = z.array(z.looseObject({ val: chString }));

const traceRefRowsSchema = z.array(z.looseObject({ TenantId: chString, TraceId: chString }));

/** Any column can be a discrete facet, so its value is read as whatever ClickHouse wrote. */
const discreteValueRowsSchema = z.array(
  z.looseObject({ discrete_value: z.unknown(), cnt: numeric, total_distinct: numeric }),
);

const rangeRowsSchema = z.array(z.looseObject({ min_val: z.unknown(), max_val: z.unknown() }));

const keyedFacetRowsSchema = z.array(
  z.looseObject({
    facet_key: chString,
    facet_value: chString,
    cnt: numeric,
    total_distinct: numeric,
  }),
);

const rangeFacetRowsSchema = z.array(z.record(z.string(), z.unknown()));

/**
 * Buffer for partition-pruning in new-trace-count subquery; matches withPartitionHint.
 */
const SINCE_WINDOW_BUFFER_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * One list row. The list mapper only reads a fixed set of keys out of
 * `Attributes`, so each is projected individually and ClickHouse skips the
 * full Map column — the dominant cost on traces with large attribute bags.
 */
const listSummaryRowSchema = z.looseObject({
  TraceId: chString,
  TenantId: chString,
  AttrSpanName: chString,
  AttrServiceName: chString,
  AttrConversationId: chString,
  AttrUserId: chString,
  AttrOrigin: chString,
  AttrNonBillable: chString,
  AttrCacheReadTokens: chString,
  AttrCacheCreationTokens: chString,
  AttrReasoningTokens: chString,
  AttrContextSizeTokens: chString,
  AttrLabels: chString,
  AttrInputMediaRefs: chString,
  AttrOutputMediaRefs: chString,
  OccurredAtMs: chNumber,
  /** The row's projection stamp; see the OccurredAtMs decode in `toTraceListRow`. */
  Version: chString.optional(),
  /** The span timing baseline column added by migration 00072 (ADR-087). */
  EarliestSpanStartMs: chNumber.optional(),
  CreatedAtMs: chNumber,
  UpdatedAtMs: chNumber,
  ComputedIOSchemaVersion: chString,
  ComputedInput: chString.nullable(),
  ComputedOutput: chString.nullable(),
  TimeToFirstTokenMs: chNumber.nullable(),
  TimeToLastTokenMs: chNumber.nullable(),
  TotalDurationMs: chNumber,
  TokensPerSecond: chNumber.nullable(),
  SpanCount: chNumber,
  ContainsErrorStatus: chBoolean,
  ContainsOKStatus: chBoolean,
  ErrorMessage: chString.nullable(),
  Models: z.array(chString),
  TotalCost: chNumber.nullable(),
  NonBilledCost: chNumber.nullable(),
  TokensEstimated: chBoolean,
  TotalPromptTokenCount: chNumber.nullable(),
  TotalCompletionTokenCount: chNumber.nullable(),
  OutputFromRootSpan: chBoolean,
  OutputSpanEndTimeMs: chNumber,
  BlockedByGuardrail: chBoolean,
  TraceName: chString,
  RootSpanType: chString.nullable(),
  ContainsAi: chBoolean,
  ContainsPrompt: chBoolean,
  SelectedPromptId: chString.nullable(),
  SelectedPromptSpanId: chString.nullable(),
  LastUsedPromptId: chString.nullable(),
  LastUsedPromptVersionNumber: chNumber.nullable(),
  LastUsedPromptVersionId: chString.nullable(),
  LastUsedPromptSpanId: chString.nullable(),
  TopicId: chString.nullable(),
  SubTopicId: chString.nullable(),
  AnnotationIds: z.array(chString),
  SizeBytes: chNumber.optional(),
  LastEventOccurredAtMs: chNumber,
});

const listSummaryRowsSchema = z.array(listSummaryRowSchema);

type ClickHouseSummaryRow = z.infer<typeof listSummaryRowSchema>;

/** `live: true` (a relative preset) means `to` is rolling: skip the upper bound. */
function isLiveUpperBound(timeRange: { to: number; live?: boolean }): boolean {
  return timeRange.live === true;
}

const ts = traceSummaries;
const attribute = (key: string) => fn.mapGet(ts.Attributes, key);
const numericSort = (of: Expression<number | null, "trace_summaries">) =>
  fn.toFloat64(fn.ifNull(of, 0));

/** `TRACE_SUMMARY_TOTAL_TOKENS_SQL` built: input, output and both cache buckets. */
const TOTAL_TOKENS = fn.plus(
  fn.plus(
    fn.plus(fn.ifNull(ts.TotalPromptTokenCount, 0), fn.ifNull(ts.TotalCompletionTokenCount, 0)),
    fn.toUInt64OrZero(attribute(RESERVED_CACHE_READ_TOKENS)),
  ),
  fn.toUInt64OrZero(attribute(RESERVED_CACHE_CREATION_TOKENS)),
);

/**
 * Every list sort as one finite number, which ORDER BY, the keyset comparison and the
 * service-side cursor all use: `OccurredAt` in epoch ms, a missing metric as 0.
 */
const SORT_EXPRESSIONS: Record<TraceListSortColumn, Expression<number, "trace_summaries">> = {
  OccurredAt: fn.toFloat64(fn.toUnixTimestamp64Milli(ts.OccurredAt)),
  TotalDurationMs: numericSort(ts.TotalDurationMs),
  TotalCost: numericSort(ts.TotalCost),
  SpanCount: numericSort(ts.SpanCount),
  TotalTokens: numericSort(TOTAL_TOKENS),
  TimeToFirstTokenMs: numericSort(ts.TimeToFirstTokenMs),
  TotalPromptTokenCount: numericSort(ts.TotalPromptTokenCount),
  TotalCompletionTokenCount: numericSort(ts.TotalCompletionTokenCount),
  _size_bytes: numericSort(ts._size_bytes),
};

/** The page's columns; only the fixed `Attributes` keys the list mapper reads are projected. */
const LIST_SELECTION = {
  TraceId: ts.TraceId,
  TenantId: ts.TenantId,
  AttrSpanName: attribute("langwatch.span.name"),
  AttrServiceName: attribute("service.name"),
  AttrConversationId: attribute("gen_ai.conversation.id"),
  AttrUserId: attribute("langwatch.user_id"),
  AttrOrigin: attribute("langwatch.origin"),
  AttrNonBillable: attribute("langwatch.cost.non_billable"),
  AttrCacheReadTokens: attribute(RESERVED_CACHE_READ_TOKENS),
  AttrInputMediaRefs: attribute("langwatch.reserved.media_refs.input"),
  AttrOutputMediaRefs: attribute("langwatch.reserved.media_refs.output"),
  AttrCacheCreationTokens: attribute(RESERVED_CACHE_CREATION_TOKENS),
  AttrReasoningTokens: attribute("langwatch.reserved.reasoning_tokens"),
  AttrContextSizeTokens: attribute("langwatch.reserved.context_size_tokens"),
  AttrLabels: attribute("langwatch.labels"),
  OccurredAtMs: fn.toUnixTimestamp64Milli(ts.OccurredAt),
  Version: ts.Version,
  EarliestSpanStartMs: ts.EarliestSpanStartMs,
  CreatedAtMs: fn.toUnixTimestamp64Milli(ts.CreatedAt),
  UpdatedAtMs: fn.toUnixTimestamp64Milli(ts.UpdatedAt),
  ComputedIOSchemaVersion: ts.ComputedIOSchemaVersion,
  ComputedInput: ts.ComputedInput,
  ComputedOutput: ts.ComputedOutput,
  TimeToFirstTokenMs: ts.TimeToFirstTokenMs,
  TimeToLastTokenMs: ts.TimeToLastTokenMs,
  TotalDurationMs: ts.TotalDurationMs,
  TokensPerSecond: ts.TokensPerSecond,
  SpanCount: ts.SpanCount,
  ContainsErrorStatus: ts.ContainsErrorStatus,
  ContainsOKStatus: ts.ContainsOKStatus,
  ErrorMessage: ts.ErrorMessage,
  Models: ts.Models,
  TotalCost: ts.TotalCost,
  NonBilledCost: ts.NonBilledCost,
  TokensEstimated: ts.TokensEstimated,
  TotalPromptTokenCount: ts.TotalPromptTokenCount,
  TotalCompletionTokenCount: ts.TotalCompletionTokenCount,
  OutputFromRootSpan: ts.OutputFromRootSpan,
  OutputSpanEndTimeMs: ts.OutputSpanEndTimeMs,
  BlockedByGuardrail: ts.BlockedByGuardrail,
  TraceName: ts.TraceName,
  RootSpanType: ts.RootSpanType,
  ContainsAi: ts.ContainsAi,
  ContainsPrompt: ts.ContainsPrompt,
  SelectedPromptId: ts.SelectedPromptId,
  SelectedPromptSpanId: ts.SelectedPromptSpanId,
  LastUsedPromptId: ts.LastUsedPromptId,
  LastUsedPromptVersionNumber: ts.LastUsedPromptVersionNumber,
  LastUsedPromptVersionId: ts.LastUsedPromptVersionId,
  LastUsedPromptSpanId: ts.LastUsedPromptSpanId,
  TopicId: ts.TopicId,
  SubTopicId: ts.SubTopicId,
  AnnotationIds: ts.AnnotationIds,
  SizeBytes: ts._size_bytes,
  LastEventOccurredAtMs: fn.toUnixTimestamp64Milli(ts.LastEventOccurredAt),
};

/** The window a list read covers on `OccurredAt`; a live range leaves the upper bound open. */
function occurredWithin(timeRange: {
  from: number;
  to: number;
  live?: boolean;
}): Condition<"trace_summaries"> {
  const from = cond.gte(ts.OccurredAt, timeRange.from);
  return isLiveUpperBound(timeRange) ? from : cond.and(from, cond.lte(ts.OccurredAt, timeRange.to));
}

/** The compiled filter as one term; an empty filter narrows nothing. */
function filterTerm(filter: TraceFilterCompilation): TraceFilterCondition {
  return filter.kind === "compiled" ? filter.where : () => cond.always();
}

/**
 * The proof's windows and the time range decide the latest-version election; the filter
 * applies after it, or a re-annotated trace answers to both annotation buckets.
 */
function electedSummaries<S extends ReaderScope>({
  start,
  timeRange,
  filter,
}: {
  start: ClickHouseReadStart<S>;
  timeRange: { from: number; to: number; live?: boolean };
  filter: TraceFilterCompilation;
}) {
  return start
    .from(ts)
    .withinWindows()
    .where(() => occurredWithin(timeRange))
    .where(filterTerm(filter), { inElection: false });
}

/** A list read's proof scope, and its filter compiled for that scope. */
function listScopeOf({
  authorization,
  compileFilter,
}: {
  authorization: Authorization;
  compileFilter?: TraceFilterCompile;
}) {
  const scope = builtTenantScope.fromProof({ authorization, reads: "traces" });
  const filter: TraceFilterCompilation = compileFilter?.({ scope }) ?? { kind: "empty" };
  return { scope, filter };
}

/** Rows past the cursor; (tenant, trace id) breaks ties, since two members may share an id. */
function pastCursor({
  sort,
  ascending,
  cursor,
}: {
  sort: Expression<number, "trace_summaries">;
  ascending: boolean;
  cursor: TraceListCursor;
}): Condition<"trace_summaries"> {
  const beyond = ascending ? cond.gt(sort, cursor.sortValue) : cond.lt(sort, cursor.sortValue);
  return cond.or(
    beyond,
    cond.and(
      cond.eq(sort, cursor.sortValue),
      cond.gt(
        fn.tuple(ts.TenantId, ts.TraceId),
        fn.tuple(param.string(cursor.tenantId), param.string(cursor.traceId)),
      ),
    ),
  );
}

/**
 * One page in two stages: the inner read picks the page's (tenant, trace, version) keys from the
 * light columns, the outer reads the payload for those rows alone. Many traces share a sort value,
 * so (TenantId, TraceId) completes the order and adjacent pages neither repeat nor skip a row.
 */
function listPageStatement(query: TraceListQuery) {
  const { scope, filter } = listScopeOf(query);
  const sort = SORT_EXPRESSIONS[query.sort.column];
  const ascending = query.sort.direction === "asc";
  const direction = ascending ? "ASC" : "DESC";
  return electedSummaries({ start: clickhouseRead({ scope }), timeRange: query.timeRange, filter })
    .select(LIST_SELECTION)
    .where(({ within }) =>
      within(fn.tuple(ts.TenantId, ts.TraceId, ts.UpdatedAt), (sub) => {
        const keys = electedSummaries({ start: sub, timeRange: query.timeRange, filter })
          .select({ TenantId: ts.TenantId, TraceId: ts.TraceId, UpdatedAt: ts.UpdatedAt })
          .latestVersion();
        const { cursor } = query;
        const paged =
          cursor === undefined
            ? keys
            : keys.where(() => pastCursor({ sort, ascending, cursor }), { inElection: false });
        return paged
          .orderBy(sort, direction)
          .orderBy(ts.TenantId, "ASC")
          .orderBy(ts.TraceId, "ASC")
          .limit(query.limit)
          .offset(query.offset ?? 0);
      }),
    )
    .orderBy(sort, direction)
    .orderBy(ts.TenantId, "ASC")
    .orderBy(ts.TraceId, "ASC")
    .limit(query.limit)
    .build();
}

/** The window's latest traces under the filter, counted. */
function listCountStatement(query: TraceListQuery) {
  const { scope, filter } = listScopeOf(query);
  return electedSummaries({ start: clickhouseRead({ scope }), timeRange: query.timeRange, filter })
    .select({ totalHits: fn.count() })
    .latestVersion()
    .build();
}

/** Each suggested field's stored value; a trace's models suggest one value each. */
const SUGGEST_EXPRESSIONS: Record<
  TraceSuggestField,
  Expression<string | null, "trace_summaries">
> = {
  model: fn.arrayJoin(ts.Models),
  service: TRACE_SUMMARY_CATEGORICAL_EXPRESSIONS.service,
  user: TRACE_SUMMARY_CATEGORICAL_EXPRESSIONS.user,
  origin: TRACE_SUMMARY_CATEGORICAL_EXPRESSIONS.origin,
};

/**
 * A field's values from a prefix among the latest summaries since `fromMs`. The prefix applies
 * after the election, so an old version's value is never suggested.
 */
function distinctValuesStatement({
  authorization,
  field,
  prefix,
  limit,
  fromMs,
}: {
  authorization: Authorization;
  field: TraceSuggestField;
  prefix: string;
  limit: number;
  fromMs: number;
}) {
  const value = SUGGEST_EXPRESSIONS[field];
  return clickhouseRead({
    scope: builtTenantScope.fromProof({ authorization, reads: "traces" }),
  })
    .from(ts)
    .withinWindows()
    .where(() => cond.gte(ts.OccurredAt, fromMs))
    .where(() => fn.like(value, `${prefix}%`), { inElection: false })
    .select({ val: value })
    .distinct()
    .latestVersion()
    .limit(limit)
    .build();
}

/** A value picker's read: one key's values in the window, optionally from a prefix. */
type ValuePickerQuery = {
  authorization: Authorization;
  timeRange: { from: number; to: number };
  attributeKey: string;
  prefix?: string;
  limit: number;
  offset: number;
};

/**
 * A picker reads the distinct values in a bounded sample of rows, uncounted: a low-cardinality key
 * shows every value, a high-cardinality one is narrowed by its prefix. The sample stops at 3s.
 */
const VALUE_SAMPLE_ROWS = 50_000;
const VALUE_SAMPLE_SETTINGS = {
  max_execution_time: 3,
  timeout_overflow_mode: "break",
  max_threads: 8,
} as const;

const pickedValueRowsSchema = z.array(z.looseObject({ facet_value: chString }));

/** A non-empty value, and when the picker has a prefix, one that starts with it in lower case. */
function pickable<T extends string>(
  value: Expression<string, T>,
  prefix: string | undefined,
): Condition<T> {
  const present = cond.ne(value, "");
  return prefix ? cond.and(present, fn.like(fn.lower(value), `${prefix}%`)) : present;
}

/** The page of a picker's sampled values, in value order. */
function sampledValuePage({
  scope,
  sample,
  query,
}: {
  scope: ProofScope;
  sample: ClickHouseTable<"sample", DerivedColumns<{ facet_value: string }>, "derived">;
  query: ValuePickerQuery;
}) {
  return clickhouseRead({ scope })
    .from(sample)
    .select({ facet_value: sample.facet_value })
    .orderBy(sample.facet_value, "ASC")
    .limit(query.limit)
    .offset(query.offset)
    .build();
}

function pickerScopeOf(query: ValuePickerQuery): ProofScope {
  return builtTenantScope.fromProof({ authorization: query.authorization, reads: "traces" });
}

/** One trace `Attributes` key's values. */
function attributeValuesStatement(query: ValuePickerQuery) {
  const scope = pickerScopeOf(query);
  const value = attribute(query.attributeKey);
  const sample = clickhouseRead({ scope })
    .from(ts)
    .withinWindows()
    .select({ facet_value: value })
    .distinct()
    .prewhere(({ and, gte, lte }) =>
      and(
        gte(ts.OccurredAt, query.timeRange.from),
        lte(ts.OccurredAt, query.timeRange.to),
        fn.mapContains(ts.Attributes, query.attributeKey),
      ),
    )
    .where(() => pickable(value, query.prefix))
    .limit(VALUE_SAMPLE_ROWS)
    .settings(VALUE_SAMPLE_SETTINGS)
    .as("sample");
  return sampledValuePage({ scope, sample, query });
}

/** One span attribute's values, from `stored_spans.SpanAttributes`. */
function spanAttributeValuesStatement(query: ValuePickerQuery) {
  const scope = pickerScopeOf(query);
  const value = fn.mapGet(storedSpans.SpanAttributes, query.attributeKey);
  const sample = clickhouseRead({ scope })
    .from(storedSpans)
    .withinWindows()
    .select({ facet_value: value })
    .distinct()
    .prewhere(({ and, gte, lte }) =>
      and(
        gte(storedSpans.StartTime, query.timeRange.from),
        lte(storedSpans.StartTime, query.timeRange.to),
        fn.mapContains(storedSpans.SpanAttributes, query.attributeKey),
      ),
    )
    .where(() => pickable(value, query.prefix))
    .limit(VALUE_SAMPLE_ROWS)
    .settings(VALUE_SAMPLE_SETTINGS)
    .as("sample");
  return sampledValuePage({ scope, sample, query });
}

/**
 * One event attribute's values: `Events.Attributes` is an array of maps beside `Events.Name`, so a
 * span gives one candidate per event carrying the key. The prefix filters inside the array.
 */
function eventAttributeValuesStatement(query: ValuePickerQuery) {
  const scope = pickerScopeOf(query);
  const events = storedSpans["Events.Attributes"];
  const sample = clickhouseRead({ scope })
    .from(storedSpans)
    .withinWindows()
    .select({
      facet_value: fn.arrayJoin(
        fn.arrayFilter(
          (value) => pickable(value, query.prefix),
          fn.arrayMap((attributes) => fn.mapGet(attributes, query.attributeKey), events),
        ),
      ),
    })
    .distinct()
    .prewhere(({ and, gte, lte }) =>
      and(
        gte(storedSpans.StartTime, query.timeRange.from),
        lte(storedSpans.StartTime, query.timeRange.to),
        fn.arrayExists((attributes) => fn.mapContains(attributes, query.attributeKey), events),
      ),
    )
    .limit(VALUE_SAMPLE_ROWS)
    .settings(VALUE_SAMPLE_SETTINGS)
    .as("sample");
  return sampledValuePage({ scope, sample, query });
}

/** Sampled values carry no counts. */
function pickedValues(rows: unknown): CategoricalFacetResult {
  return {
    values: pickedValueRowsSchema.parse(rows).map((row) => ({ value: row.facet_value, count: 0 })),
    totalDistinct: 0,
  };
}

/** Seconds a sidebar facet read may run before ClickHouse stops it. */
const FACET_READ_MAX_EXECUTION_SECONDS = 20;

/**
 * Every sidebar facet read: stopped on the server at its time cap and not run again, under a
 * 2 GiB memory cap. The sidebar omits a stopped facet. specs/traces-v2/search.feature
 */
const FACET_READ = {
  clickhouse_settings: {
    // ClickHouse settings are string-typed over the wire.
    max_execution_time: String(FACET_READ_MAX_EXECUTION_SECONDS),
    timeout_overflow_mode: "throw",
    max_memory_usage: String(2 * 1024 * 1024 * 1024),
  } as Record<string, string>,
  retryOnTimeout: false,
  format: "JSONEachRow",
} as const;

function buildWhereClauseForTable({
  timeRange,
  timeColumn,
}: {
  timeRange: { from: number; to: number; live?: boolean };
  timeColumn: TenantScopeTimeColumn;
}): { sql: string; params: Record<string, unknown> } {
  const parts = [
    tenantScope(timeColumn),
    `${timeColumn} >= fromUnixTimestamp64Milli({timeFrom:Int64})`,
  ];
  const params: Record<string, unknown> = { timeFrom: timeRange.from };

  if (!isLiveUpperBound(timeRange)) {
    parts.push(`${timeColumn} <= fromUnixTimestamp64Milli({timeTo:Int64})`);
    params.timeTo = timeRange.to;
  }

  return { sql: parts.join(" AND "), params };
}

/**
 * The active trace filter as an `AND` fragment for a facet read on `table`,
 * placed after the version dedup so it never decides which version is the
 * latest. Empty when there is no filter.
 */
function facetFilterFragment(
  table: FacetTableName,
  filterWhere: TraceFilterWhere | undefined,
  timeRange: { to: number; live?: boolean },
): TraceFilterWhere {
  if (!filterWhere) return { sql: "", params: {} };

  const scoped = scopeTraceFilterToTable({
    table,
    filterWhere,
    isLiveWindow: timeRange.live === true,
  });

  return { sql: `AND ${scoped.sql}`, params: scoped.params };
}

export class TraceListClickHouseRepository implements TraceListRepository {
  private readonly clickhouse: AuthorizedClickHouse;
  private readonly reader: Pick<ClickHouseQueryClient, "read">;

  private constructor(deps: {
    clickhouse: AuthorizedClickHouse;
    reader: Pick<ClickHouseQueryClient, "read">;
  }) {
    this.clickhouse = deps.clickhouse;
    this.reader = deps.reader;
  }

  static create(deps: {
    clickhouse: AuthorizedClickHouse;
    reader: Pick<ClickHouseQueryClient, "read">;
  }): TraceListClickHouseRepository {
    return new TraceListClickHouseRepository(deps);
  }

  async listAll(query: TraceListQuery): Promise<TraceListRepositoryPage> {
    const [page, count] = await Promise.all([
      this.reader.read({
        // ID_BOUND_SKIP: one page of the window's traces, bounded by OccurredAt.
        statement: listPageStatement(query),
        table: ts.$table.name,
      }),
      this.reader.read({
        // ID_BOUND_SKIP: the window's trace count, bounded by OccurredAt.
        statement: listCountStatement(query),
        table: ts.$table.name,
      }),
    ]);

    const rows = listSummaryRowsSchema.parse(page.rows);
    const countRows = totalHitsRowsSchema.parse(count.rows);
    const totalHits = countRows.length > 0 ? Number(countRows[0]!.totalHits) : 0;

    return {
      rows: rows.map((row) => this.toTraceListRow(row)),
      totalHits,
    };
  }

  async findCount(params: {
    authorization: Authorization;
    timeRange: { from: number; to: number };
    since: number;
    compileFilter?: TraceFilterCompile;
  }): Promise<number> {
    // Live "new traces since `since`" poll. A span-level filter scans stored_spans over the
    // window: raising its lower bound to since (minus a buffer) prunes that subquery, since a
    // matching span's StartTime >= OccurredAt > since.
    const effectiveFrom = Math.max(params.timeRange.from, params.since - SINCE_WINDOW_BUFFER_MS);
    const { scope, filter } = listScopeOf(params);
    const statement = electedSummaries({
      start: clickhouseRead({ scope }),
      timeRange: { ...params.timeRange, from: effectiveFrom },
      filter,
    })
      .where(() => cond.gt(ts.OccurredAt, params.since))
      .select({ cnt: fn.count() })
      .latestVersion()
      .build();

    // ID_BOUND_SKIP: the window's new-trace count, bounded by OccurredAt.
    const result = await this.reader.read({ statement, table: ts.$table.name });
    const rows = countRowsSchema.parse(result.rows);
    return Number(rows[0]?.cnt ?? 0);
  }

  async findTraceRefs(params: {
    authorization: Authorization;
    timeRange: { from: number; to: number; live?: boolean };
    compileFilter?: TraceFilterCompile;
    limit: number;
  }): Promise<TraceRef[]> {
    const { scope, filter } = listScopeOf(params);
    // Two unmerged versions can tie on max(UpdatedAt), so LIMIT 1 BY keeps one per trace. It
    // reads only the two key columns, so none of LIMIT BY's heavy-column cost applies.
    const statement = electedSummaries({
      start: clickhouseRead({ scope }),
      timeRange: params.timeRange,
      filter,
    })
      .select({ TenantId: ts.TenantId, TraceId: ts.TraceId })
      .latestVersion()
      .orderBy(ts.OccurredAt, "DESC")
      .orderBy(ts.TenantId, "ASC")
      .orderBy(ts.TraceId, "ASC")
      .limitBy(1, ts.TenantId, ts.TraceId)
      .limit(params.limit)
      .build();

    // ID_BOUND_SKIP: the filter's newest traces, bounded by OccurredAt and the limit.
    const result = await this.reader.read({ statement, table: ts.$table.name });
    return traceRefRowsSchema
      .parse(result.rows)
      .map((row) => ({ tenantId: row.TenantId, traceId: row.TraceId }));
  }

  async findDistinctValues(params: {
    authorization: Authorization;
    field: TraceSuggestField;
    prefix: string;
    limit: number;
  }): Promise<string[]> {
    // Suggest is interactive: the last 30 days keep it off cold (S3-tier) partitions, trading
    // completeness on stale values for sub-second answers.
    const SUGGEST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
    const fromMs = nowInstant().epochMilliseconds - SUGGEST_WINDOW_MS;
    // ID_BOUND_SKIP: the last 30 days' summaries, bounded by OccurredAt and the limit.
    const result = await this.reader.read({
      statement: distinctValuesStatement({ ...params, fromMs }),
      table: ts.$table.name,
    });
    return distinctValueRowsSchema.parse(result.rows).map((row) => row.val);
  }

  async findCategoricalFacet(params: {
    authorization: Authorization;
    timeRange: { from: number; to: number; live?: boolean };
    table: FacetTableName;
    timeColumn: TenantScopeTimeColumn;
    facetExpression: string;
    limit: number;
    offset: number;
    prefix?: string;
    filterWhere?: TraceFilterWhere;
  }): Promise<CategoricalFacetResult> {
    const { sql: whereClause, params: queryParams } = buildWhereClauseForTable({
      timeRange: params.timeRange,
      timeColumn: params.timeColumn,
    });
    const filter = facetFilterFragment(params.table, params.filterWhere, params.timeRange);

    const prefixFilter = params.prefix
      ? `AND ${params.facetExpression} ILIKE concat({prefix:String}, '%')`
      : "";

    // `trace_summaries` is a ReplacingMergeTree-style projection — the same
    // logical trace can have multiple rows (different `UpdatedAt` versions)
    // until the merge runs. Without dedup, facet counts double-count any
    // re-projected trace. Other tables (evaluation_runs, stored_spans) keep
    // their own row identity per evaluation/span, so we don't dedup there.
    const needsDedup = params.table === "trace_summaries";
    const dedupFilter = needsDedup
      ? `AND (TenantId, TraceId, UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM ${params.table}
            WHERE ${whereClause}
            GROUP BY TenantId, TraceId
          )`
      : "";

    const client = this.clickhouse.as(params.authorization, {
      reads: "traces",
    });
    const result = await client.query({
      query: `
        SELECT
          ${params.facetExpression} AS facet_value,
          count() AS cnt,
          count() OVER () AS total_distinct
        FROM ${params.table}
        WHERE ${whereClause}
          ${dedupFilter}
          ${filter.sql}
          AND ${params.facetExpression} != ''
          ${prefixFilter}
        GROUP BY facet_value
        ORDER BY cnt DESC
        LIMIT {limit:UInt32} OFFSET {offset:UInt32}
      `,
      query_params: {
        ...filter.params,
        ...queryParams,
        limit: params.limit,
        offset: params.offset,
        ...(params.prefix ? { prefix: params.prefix } : {}),
      },
      ...FACET_READ,
    });

    const rows = facetRowsSchema.parse(await result.json());
    return TraceListClickHouseRepository.mapFacetRows(rows);
  }

  async findDiscreteValues(params: {
    authorization: Authorization;
    timeRange: { from: number; to: number; live?: boolean };
    table: FacetTableName;
    timeColumn: TenantScopeTimeColumn;
    column: string;
    limit: number;
    filterWhere?: TraceFilterWhere;
  }): Promise<DiscreteFacetResult> {
    const { sql: whereClause, params: queryParams } = buildWhereClauseForTable({
      timeRange: params.timeRange,
      timeColumn: params.timeColumn,
    });
    const filter = facetFilterFragment(params.table, params.filterWhere, params.timeRange);

    // Same ReplacingMergeTree dedup as findCategoricalFacet — only
    // trace_summaries re-projects a logical trace across versions.
    const needsDedup = params.table === "trace_summaries";
    const dedupFilter = needsDedup
      ? `AND (TenantId, TraceId, UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM ${params.table}
            WHERE ${whereClause}
            GROUP BY TenantId, TraceId
          )`
      : "";

    const client = this.clickhouse.as(params.authorization, {
      reads: "traces",
    });
    const result = await client.query({
      query: `
        SELECT
          ${params.column} AS discrete_value,
          count() AS cnt,
          count() OVER () AS total_distinct
        FROM ${params.table}
        WHERE ${whereClause}
          ${dedupFilter}
          ${filter.sql}
          AND ${params.column} IS NOT NULL
        GROUP BY discrete_value
        ORDER BY discrete_value ASC
        LIMIT {limit:UInt32}
      `,
      query_params: { ...filter.params, ...queryParams, limit: params.limit },
      ...FACET_READ,
    });

    const rows = discreteValueRowsSchema.parse(await result.json());
    return {
      values: rows.map((r) => ({
        value: Number(r.discrete_value),
        count: Number(r.cnt),
      })),
      // `count() OVER ()` is evaluated over the full grouped set before LIMIT,
      // so this is the true distinct count even when values are capped.
      distinctCount: Number(rows[0]?.total_distinct ?? 0),
    };
  }

  async findCategoricalFacetRaw(params: {
    authorization: Authorization;
    query: TraceListFacetQuery;
  }): Promise<CategoricalFacetResult> {
    const client = this.clickhouse.as(params.authorization, {
      reads: "traces",
    });
    const result = await client.query({
      query: params.query.sql,
      query_params: params.query.params,
      ...FACET_READ,
      // A facet's own memory ceiling overrides the shared one; never the time cap.
      clickhouse_settings: {
        ...FACET_READ.clickhouse_settings,
        ...params.query.settings,
        max_execution_time: String(FACET_READ_MAX_EXECUTION_SECONDS),
        timeout_overflow_mode: "throw",
      },
    });

    const rows = facetRowsSchema.parse(await result.json());
    return TraceListClickHouseRepository.mapFacetRows(rows);
  }

  async findRangeStatsForTable(params: {
    authorization: Authorization;
    timeRange: { from: number; to: number; live?: boolean };
    table: FacetTableName;
    timeColumn: TenantScopeTimeColumn;
    column: string;
    filterWhere?: TraceFilterWhere;
  }): Promise<{ min: number; max: number }> {
    const { sql: whereClause, params: queryParams } = buildWhereClauseForTable({
      timeRange: params.timeRange,
      timeColumn: params.timeColumn,
    });
    const filter = facetFilterFragment(params.table, params.filterWhere, params.timeRange);

    // Match the dedup behaviour of findCategoricalFacet/findBatchedFacets:
    // trace_summaries is a ReplacingMergeTree projection, so without the
    // IN-tuple dedup older versions of a trace widen the discovered
    // min/max envelope until merges run. Other facet tables keep one row
    // per logical entity (eval/span) and don't need it.
    const needsDedup = params.table === "trace_summaries";
    const dedupFilter = needsDedup
      ? `AND (TenantId, TraceId, UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM ${params.table}
            WHERE ${whereClause}
            GROUP BY TenantId, TraceId
          )`
      : "";

    const client = this.clickhouse.as(params.authorization, {
      reads: "traces",
    });
    const result = await client.query({
      query: `
        SELECT
          min(${params.column}) AS min_val,
          max(${params.column}) AS max_val
        FROM ${params.table}
        WHERE ${whereClause}
          ${dedupFilter}
          ${filter.sql}
      `,
      query_params: { ...filter.params, ...queryParams },
      ...FACET_READ,
    });

    const rows = rangeRowsSchema.parse(await result.json());
    const row = rows[0];
    return { min: Number(row?.min_val ?? 0), max: Number(row?.max_val ?? 0) };
  }

  /**
   * Tuple-typed arrayJoin packs every facet into a single row stream. Each (key, expression)
   * pair becomes one (key, value) tuple per row.
   */
  private async fetchCategoricalFacets({
    client,
    specs,
    table,
    whereClause,
    dedupFilter,
    filterClause,
    queryParams,
    topN,
  }: {
    client: TenantScopedReader;
    specs: { key: string; expression: string }[];
    table: FacetTableName;
    whereClause: string;
    dedupFilter: string;
    filterClause: string;
    queryParams: Record<string, unknown>;
    topN: number;
  }): Promise<Record<string, CategoricalFacetResult>> {
    const tupleArray = specs
      .map((s) => `(${this.quoteIdentifier(s.key)}, toString(${s.expression}))`)
      .join(", ");

    const query = `
              SELECT facet_key, facet_value, cnt, total_distinct FROM (
                SELECT
                  facet_key,
                  facet_value,
                  cnt,
                  count() OVER (PARTITION BY facet_key) AS total_distinct
                FROM (
                  SELECT facet_key, facet_value, count() AS cnt FROM (
                    SELECT
                      arrayJoin([${tupleArray}]) AS kv,
                      kv.1 AS facet_key,
                      kv.2 AS facet_value
                    FROM ${table}
                    WHERE ${whereClause}
                      ${dedupFilter}
                      ${filterClause}
                  )
                  WHERE facet_value != ''
                  GROUP BY facet_key, facet_value
                )
              )
              ORDER BY facet_key, cnt DESC
              LIMIT {topN:UInt32} BY facet_key
            `;

    const result = await client.query({
      query,
      query_params: { ...queryParams, topN },
      ...FACET_READ,
    });

    const rows = keyedFacetRowsSchema.parse(await result.json());

    const out: Record<string, CategoricalFacetResult> = {};
    for (const spec of specs) {
      out[spec.key] = { values: [], totalDistinct: 0 };
    }
    for (const row of rows) {
      const bucket = out[row.facet_key];
      if (!bucket) continue;
      bucket.values.push({ value: row.facet_value, count: Number(row.cnt) });
      bucket.totalDistinct = Number(row.total_distinct);
    }

    return out;
  }

  /**
   * Indexed aliases, so arbitrary registry keys cannot collide with reserved SQL words or with
   * each other after sanitisation.
   */
  private async fetchRangeFacets({
    client,
    specs,
    table,
    whereClause,
    dedupFilter,
    filterClause,
    queryParams,
  }: {
    client: TenantScopedReader;
    specs: { key: string; expression: string }[];
    table: FacetTableName;
    whereClause: string;
    dedupFilter: string;
    filterClause: string;
    queryParams: Record<string, unknown>;
  }): Promise<Record<string, { min: number; max: number }>> {
    const aggClauses = specs
      .flatMap((s, i) => [
        `min(${s.expression}) AS r_${i}_min`,
        `max(${s.expression}) AS r_${i}_max`,
      ])
      .join(", ");

    const query = `
              SELECT ${aggClauses}
              FROM ${table}
              WHERE ${whereClause}
                ${dedupFilter}
                ${filterClause}
            `;

    const result = await client.query({
      query,
      query_params: queryParams,
      ...FACET_READ,
    });

    const rows = rangeFacetRowsSchema.parse(await result.json());
    const row = rows[0] ?? {};
    const out: Record<string, { min: number; max: number }> = {};
    for (let i = 0; i < specs.length; i += 1) {
      const spec = specs[i]!;
      out[spec.key] = {
        min: Number(row[`r_${i}_min`] ?? 0),
        max: Number(row[`r_${i}_max`] ?? 0),
      };
    }

    return out;
  }

  async findBatchedFacets(params: {
    authorization: Authorization;
    timeRange: { from: number; to: number; live?: boolean };
    table: FacetTableName;
    timeColumn: TenantScopeTimeColumn;
    categoricalSpecs: { key: string; expression: string }[];
    rangeSpecs: { key: string; expression: string }[];
    topN: number;
    filterWhere?: TraceFilterWhere;
  }): Promise<BatchedFacetResult> {
    const { sql: whereClause, params: baseParams } = buildWhereClauseForTable({
      timeRange: params.timeRange,
      timeColumn: params.timeColumn,
    });
    const filter = facetFilterFragment(params.table, params.filterWhere, params.timeRange);
    const queryParams = { ...filter.params, ...baseParams };

    // `trace_summaries` is a ReplacingMergeTree-style projection — same trace
    // can have multiple `UpdatedAt` versions until merge runs. The other facet
    // tables (`evaluation_runs`, `stored_spans`) keep row identity per record.
    const needsDedup = params.table === "trace_summaries";
    const dedupFilter = needsDedup
      ? `AND (TenantId, TraceId, UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM ${params.table}
            WHERE ${whereClause}
            GROUP BY TenantId, TraceId
          )`
      : "";

    const client = this.clickhouse.as(params.authorization, { reads: "traces" });
    const shared = {
      client,
      table: params.table,
      whereClause,
      dedupFilter,
      filterClause: filter.sql,
      queryParams,
    };

    const categoricalsPromise =
      params.categoricalSpecs.length === 0
        ? Promise.resolve({})
        : this.fetchCategoricalFacets({
            ...shared,
            specs: params.categoricalSpecs,
            topN: params.topN,
          });

    const rangesPromise =
      params.rangeSpecs.length === 0
        ? Promise.resolve({})
        : this.fetchRangeFacets({ ...shared, specs: params.rangeSpecs });

    const [categoricals, ranges] = await Promise.all([categoricalsPromise, rangesPromise]);

    return { categoricals, ranges };
  }

  /**
   * Quote a registry key for safe use as a ClickHouse string literal. The
   * registry only ships ASCII identifiers, but we still defend in depth.
   */
  private quoteIdentifier(key: string): string {
    if (!/^[a-zA-Z0-9_]+$/.test(key)) {
      throw new Error(`Invalid facet key: ${key}`);
    }
    return `'${key}'`;
  }

  async findAttributeValues(params: ValuePickerQuery): Promise<CategoricalFacetResult> {
    // ID_BOUND_SKIP: a bounded sample of the window's summaries, by OccurredAt.
    const result = await this.reader.read({
      statement: attributeValuesStatement(params),
      table: ts.$table.name,
    });
    return pickedValues(result.rows);
  }

  async findEventAttributeValues(params: ValuePickerQuery): Promise<CategoricalFacetResult> {
    // ID_BOUND_SKIP: a bounded sample of the window's spans, by StartTime.
    const result = await this.reader.read({
      statement: eventAttributeValuesStatement(params),
      table: storedSpans.$table.name,
    });
    return pickedValues(result.rows);
  }

  async findSpanAttributeValues(params: ValuePickerQuery): Promise<CategoricalFacetResult> {
    // ID_BOUND_SKIP: a bounded sample of the window's spans, by StartTime.
    const result = await this.reader.read({
      statement: spanAttributeValuesStatement(params),
      table: storedSpans.$table.name,
    });
    return pickedValues(result.rows);
  }

  private toTraceListRow(row: ClickHouseSummaryRow): TraceListRow {
    return {
      tenantId: row.TenantId,
      traceId: row.TraceId,
      spanCount: row.SpanCount,
      totalDurationMs: Number(row.TotalDurationMs),
      computedIOSchemaVersion: row.ComputedIOSchemaVersion,
      computedInput: row.ComputedInput,
      computedOutput: row.ComputedOutput,
      timeToFirstTokenMs: row.TimeToFirstTokenMs,
      timeToLastTokenMs: row.TimeToLastTokenMs,
      tokensPerSecond: row.TokensPerSecond,
      containsErrorStatus: !!row.ContainsErrorStatus,
      containsOKStatus: !!row.ContainsOKStatus,
      errorMessage: row.ErrorMessage,
      models: row.Models,
      totalCost: row.TotalCost,
      nonBilledCost: row.NonBilledCost ?? null,
      tokensEstimated: !!row.TokensEstimated,
      totalPromptTokenCount: row.TotalPromptTokenCount,
      totalCompletionTokenCount: row.TotalCompletionTokenCount,
      outputFromRootSpan: !!row.OutputFromRootSpan,
      outputSpanEndTimeMs: Number(row.OutputSpanEndTimeMs),
      blockedByGuardrail: !!row.BlockedByGuardrail,
      traceName: row.TraceName ?? "",
      rootSpanType: row.RootSpanType,
      containsAi: !!row.ContainsAi,
      containsPrompt: !!row.ContainsPrompt,
      selectedPromptId: row.SelectedPromptId,
      selectedPromptSpanId: row.SelectedPromptSpanId,
      selectedPromptStartTimeMs: null,
      lastUsedPromptId: row.LastUsedPromptId,
      lastUsedPromptVersionNumber: row.LastUsedPromptVersionNumber,
      lastUsedPromptVersionId: row.LastUsedPromptVersionId,
      lastUsedPromptSpanId: row.LastUsedPromptSpanId,
      lastUsedPromptStartTimeMs: null,
      topicId: row.TopicId,
      subTopicId: row.SubTopicId,
      annotationIds: row.AnnotationIds ?? [],
      sizeBytes: Number(row.SizeBytes ?? 0),
      attributes: TraceListClickHouseRepository.listAttributes(row),
      // `OccurredAt` is the frozen storage anchor since ADR-087 and
      // `EarliestSpanStartMs` is the span timing baseline it used to double as.
      // A row at an older stamp predates the split and carries both in the one
      // column, which is why this is version-gated rather than a bare read.
      storageAnchorMs: Number(row.OccurredAtMs),
      occurredAt: isStorageAnchoredVersion(row.Version)
        ? Number(row.EarliestSpanStartMs ?? 0)
        : Number(row.OccurredAtMs),
      createdAt: Number(row.CreatedAtMs),
      updatedAt: Number(row.UpdatedAtMs),
      LastEventOccurredAt: Number(row.LastEventOccurredAtMs ?? 0),
    };
  }

  private static mapFacetRows(rows: FacetRow[]): CategoricalFacetResult {
    return {
      values: rows.map((r) => ({
        value: r.facet_value,
        ...(r.facet_label ? { label: r.facet_label } : {}),
        count: Number(r.cnt),
        ...TraceListClickHouseRepository.extractFacetAggregates(r),
        ...TraceListClickHouseRepository.extractEventMetrics(r),
      })),
      totalDistinct: rows.length > 0 ? Number(rows[0]!.total_distinct) : 0,
    };
  }

  /**
   * Reshape the event facet's composite-key buckets into per-metric-key value
   * lists. Values pass through as stored — verbatim strings — so a drilldown
   * click round-trips exactly into `event.attribute.<key>:<value>`.
   */
  private static extractEventMetrics(r: FacetRow): {
    eventMetrics?: EventMetricValues[];
  } {
    if (!r.metric_values?.length) return {};
    const byKey = new Map<string, { value: string; count: number }[]>();
    for (const [composite, count] of r.metric_values) {
      const sep = composite.indexOf(EVENT_METRIC_SEP);
      if (sep <= 0) continue;
      const key = composite.slice(0, sep);
      const value = composite.slice(sep + EVENT_METRIC_SEP.length);
      // A second separator means the metric key itself carried one, so the
      // split point is a guess. Drop the bucket rather than render a row
      // whose key and value are both wrong.
      if (value === "" || value.includes(EVENT_METRIC_SEP)) continue;
      let list = byKey.get(key);
      if (!list) {
        list = [];
        byKey.set(key, list);
      }
      list.push({ value, count: Number(count) });
    }
    if (byKey.size === 0) return {};
    return {
      eventMetrics: [...byKey.entries()].map(([key, values]) => ({ key, values })),
    };
  }

  private static extractFacetAggregates(r: FacetRow): {
    aggregates?: {
      passedCount: number;
      failedCount: number;
      erroredCount: number;
      scoreMin: number | null;
      scoreMax: number | null;
      hasScore: boolean;
      distinctScores: number;
      hasLabel: boolean;
      labelValues?: { value: string; count: number }[];
    };
  } {
    // Only the evaluator facet's queryBuilder emits these columns. Other
    // facets (status, model, …) return undefined for all of them, so the
    // discriminator below avoids attaching an empty aggregates object to
    // every facet value.
    const hasNoAggregates =
      r.passed_count === undefined &&
      r.failed_count === undefined &&
      r.errored_count === undefined &&
      r.has_score === undefined &&
      r.has_label === undefined;
    if (hasNoAggregates) {
      return {};
    }
    // Reshape the `[[value, count], …]` tuples into `{ value, count }`. Drop any
    // residual empty/blank values defensively — the SQL already filters them.
    const labelValues = (r.label_values ?? [])
      .filter(([value]) => value !== "")
      .map(([value, count]) => ({ value, count: Number(count) }));
    return {
      aggregates: {
        passedCount: Number(r.passed_count ?? 0),
        failedCount: Number(r.failed_count ?? 0),
        erroredCount: Number(r.errored_count ?? 0),
        scoreMin: r.score_min == null ? null : Number(r.score_min),
        scoreMax: r.score_max == null ? null : Number(r.score_max),
        hasScore: Boolean(r.has_score),
        distinctScores: Number(r.distinct_scores ?? 0),
        hasLabel: Boolean(r.has_label),
        ...(labelValues.length > 0 ? { labelValues } : {}),
      },
    };
  }

  private static listAttributes(row: ClickHouseSummaryRow): Record<string, string> {
    const attributes: Record<string, string> = {};
    if (row.AttrSpanName) attributes["langwatch.span.name"] = row.AttrSpanName;
    if (row.AttrServiceName) attributes["service.name"] = row.AttrServiceName;
    if (row.AttrConversationId) {
      attributes["gen_ai.conversation.id"] = row.AttrConversationId;
    }
    if (row.AttrUserId) attributes["langwatch.user_id"] = row.AttrUserId;
    if (row.AttrOrigin) attributes["langwatch.origin"] = row.AttrOrigin;
    if (row.AttrNonBillable) {
      attributes["langwatch.cost.non_billable"] = row.AttrNonBillable;
    }
    // Fold-summed cache / reasoning token counts the drawer header reads to show
    // the "Cache read" / "Cache write" / reasoning rows (the raw per-span
    // gen_ai.usage.cache_* values never reach the trace attribute map).
    if (row.AttrCacheReadTokens) {
      attributes["langwatch.reserved.cache_read_tokens"] = row.AttrCacheReadTokens;
    }
    if (row.AttrInputMediaRefs) {
      attributes["langwatch.reserved.media_refs.input"] = row.AttrInputMediaRefs;
    }
    if (row.AttrOutputMediaRefs) {
      attributes["langwatch.reserved.media_refs.output"] = row.AttrOutputMediaRefs;
    }
    if (row.AttrCacheCreationTokens) {
      attributes["langwatch.reserved.cache_creation_tokens"] = row.AttrCacheCreationTokens;
    }
    if (row.AttrReasoningTokens) {
      attributes["langwatch.reserved.reasoning_tokens"] = row.AttrReasoningTokens;
    }
    if (row.AttrContextSizeTokens) {
      attributes["langwatch.reserved.context_size_tokens"] = row.AttrContextSizeTokens;
    }
    // JSON-encoded array of trace labels (e.g. '["prod","beta"]'). Preserve the
    // raw string here because TraceSummaryData.attributes is string-valued; the
    // list mapper decodes it into a string[] for the Labels column.
    if (row.AttrLabels) attributes["langwatch.labels"] = row.AttrLabels;
    return attributes;
  }
}

const facetRowSchema = z.looseObject({
  facet_value: chString,
  facet_label: chString.optional(),
  cnt: numeric,
  total_distinct: numeric,
  // Optional per-value aggregates carried by the evaluator facet's
  // custom queryBuilder so the sidebar can render the inline drilldown
  // without firing a second query per evaluator.
  passed_count: numeric.optional(),
  failed_count: numeric.optional(),
  errored_count: numeric.optional(),
  score_min: numeric.nullable().optional(),
  score_max: numeric.nullable().optional(),
  has_score: flag.optional(),
  distinct_scores: numeric.optional(),
  has_label: flag.optional(),
  // Top-N `Array(Tuple(String, UInt64))` as `[[value, count], …]`; for the
  // event facet the value is `<metric key>\x1F<stored value>` (EVENT_METRIC_SEP).
  label_values: z.array(z.tuple([chString, numeric])).optional(),
  metric_values: z.array(z.tuple([chString, numeric])).optional(),
});

const facetRowsSchema = z.array(facetRowSchema);

type FacetRow = z.infer<typeof facetRowSchema>;

// CH returns empty strings for missing Map keys; the list mapper expects
// keys absent so its ?? null / ?? "" fallbacks fire, not present-but-empty.
// Keys below match listAll's explicit Attributes[...] projections — add a
// new one in both places. If user-pinned attribute columns ship, prefer an
// extraAttributeKeys: string[] input over reintroducing the full Map projection.
