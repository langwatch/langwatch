import {
  ch,
  defineTable,
  replacing,
  type TableRow,
} from "@langwatch/clickhouse";

/**
 * One row per canonicalized span, and the item table every trace-level total is
 * a query over (ADR-103). The engine key is the span's own identity, so a
 * redelivered span collapses to one row and a `sum()` over the rows is
 * idempotent by construction.
 *
 * NOT DEPLOYED. No migration creates this table: the `stored_spans` that exists
 * is the legacy span row of `00002_create_schema.sql` — `SpanName`, `SpanKind`,
 * `SpanAttributes` as a Map, `StartTime`/`EndTime`, keyed and partitioned on
 * `StartTime` — which `span-storage.clickhouse.repository.ts` still reads under
 * those names. This declaration is the canonical row that replaces it, so it
 * needs a new table and a cutover, not an `ALTER`.
 */
export const storedSpansTable = defineTable({
  name: "stored_spans",
  merge: replacing({ version: "WrittenAt" }),
  sortKey: ["TenantId", "TraceId", "SpanId"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "AcceptedAt" },
  columns: {
    TenantId: ch.string(),
    TraceId: ch.string(),
    SpanId: ch.string(),
    ParentSpanId: ch.nullable(ch.string()),
    Name: ch.string(),
    Kind: ch.lowCardinality(ch.string()),
    /** The `langwatch.span.type` attribute, `""` when the span set none. */
    SpanType: ch.lowCardinality(ch.string()),
    StartTimeUnixMs: ch.uint64(),
    EndTimeUnixMs: ch.uint64(),
    DurationMs: ch.uint64(),
    StatusCode: ch.lowCardinality(ch.string()),
    StatusMessage: ch.nullable(ch.string()),
    InstrumentationScopeName: ch.lowCardinality(ch.string()),
    Model: ch.lowCardinality(ch.string()),
    Cost: ch.nullable(ch.float64()),
    NonBilledCost: ch.nullable(ch.float64()),
    PromptTokens: ch.nullable(ch.uint64()),
    CompletionTokens: ch.nullable(ch.uint64()),
    CacheReadTokens: ch.nullable(ch.uint64()),
    CacheWriteTokens: ch.nullable(ch.uint64()),
    ReasoningTokens: ch.nullable(ch.uint64()),
    TokensEstimated: ch.boolean(),
    AttributesJson: ch.string(),
    ResourceAttributesJson: ch.string(),
    PiiRedactionStatus: ch.lowCardinality(ch.string()),
    OccurredAt: ch.occurredAt(),
    AcceptedAt: ch.acceptedAt(),
    WrittenAt: ch.writtenAt(),
    _retention_days: ch.uint16(),
  },
});
export type StoredSpansRow = TableRow<typeof storedSpansTable.columns>;

/**
 * The trace detail row: the summary fold's derived view plus the stamps and
 * candidates a read-back needs to keep folding. It carries no span count and no
 * cost or token total — those are `totals.ts`'s query over `stored_spans`.
 */
export const traceSummariesTable = defineTable({
  name: "trace_summaries",
  merge: replacing({ version: "UpdatedAt" }),
  sortKey: ["TenantId", "TraceId"],
  partition: { by: "toYearWeek(OccurredAt)", column: "OccurredAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "OccurredAt" },
  structuralDebt: [
    {
      column: "OccurredAt",
      reason:
        "migration 00002 partitions trace_summaries on OccurredAt and the TTL reconciler expires it on the same column, and it moves backwards as earlier spans arrive — epoch sentinel rows exist. trace_analytics got the storage-anchor split in 00061; this table did not, and PARTITION BY is not alterable in place",
    },
  ],
  columns: {
    TenantId: ch.string(),
    TraceId: ch.string(),
    /** The fold's own state-shape gate (ADR-098 decision 6). */
    Version: ch.lowCardinality(ch.string()),

    TotalDurationMs: ch.int64(),

    ComputedInput: ch.nullable(ch.string()),
    ComputedOutput: ch.nullable(ch.string()),
    TimeToFirstTokenMs: ch.nullable(ch.uint32()),
    TimeToLastTokenMs: ch.nullable(ch.uint32()),

    ContainsErrorStatus: ch.boolean(),
    ContainsOKStatus: ch.boolean(),
    ErrorMessage: ch.nullable(ch.string()),

    Models: ch.array(ch.string()),

    BlockedByGuardrail: ch.boolean(),
    ContainsAi: ch.boolean(),
    ContainsPrompt: ch.boolean(),
    SelectedPromptId: ch.nullable(ch.string()),
    SelectedPromptVersionId: ch.nullable(ch.string()),
    LastUsedPromptId: ch.nullable(ch.string()),
    LastUsedPromptVersionId: ch.nullable(ch.string()),

    TraceName: ch.string(),
    RootSpanType: ch.lowCardinality(ch.nullable(ch.string())),
    RootSpanStartTimeMs: ch.nullable(ch.uint64()),
    TraceNameFromFallback: ch.boolean(),

    TopicId: ch.nullable(ch.string()),
    SubTopicId: ch.nullable(ch.string()),
    /** The assigner's own stamp, so a stale re-run cannot win on read-back. */
    TopicAssignedAt: ch.uint64(),
    TraceNameChangedAt: ch.uint64(),

    AnnotationIds: ch.array(ch.string()),
    AttributesJson: ch.string(),

    OccurredAt: ch.occurredAt(),
    AcceptedAt: ch.acceptedAt(),
    UpdatedAt: ch.writtenAt(),
    _retention_days: ch.uint16(),
  },
});
export type TraceSummariesRow = TableRow<typeof traceSummariesTable.columns>;

/**
 * The slim analytics sibling: the dimensions a dashboard filters and groups on.
 * Its measures are `totals.ts`'s query, for the same reason.
 */
export const traceAnalyticsTable = defineTable({
  name: "trace_analytics",
  merge: replacing({ version: "UpdatedAt" }),
  sortKey: ["TenantId", "OccurredAt", "TraceId"],
  partition: { by: "toYearWeek(OccurredAt)", column: "OccurredAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "OccurredAt" },
  structuralDebt: [
    {
      column: "OccurredAt",
      reason:
        "migration 00061 froze what trace_analytics writes into OccurredAt — the first business time any contribution reported, written once — but the column is still the customer's clock rather than a platform stamp, and 00039 also made it the partition key and the sort key's time leaf. Time-leading the key costs this fold's point read on (TenantId, TraceId) its primary-index seek; neither ORDER BY nor PARTITION BY is alterable in place",
    },
  ],
  columns: {
    TenantId: ch.string(),
    TraceId: ch.string(),
    Version: ch.lowCardinality(ch.string()),

    EarliestSpanStartMs: ch.uint64(),
    TotalDurationMs: ch.int64(),
    TimeToFirstTokenMs: ch.nullable(ch.uint32()),

    TraceName: ch.string(),
    TopicId: ch.nullable(ch.string()),
    SubTopicId: ch.nullable(ch.string()),
    TopicAssignedAt: ch.uint64(),
    TraceNameChangedAt: ch.uint64(),
    UserId: ch.nullable(ch.string()),
    ConversationId: ch.nullable(ch.string()),
    CustomerId: ch.nullable(ch.string()),
    Origin: ch.string(),
    Models: ch.array(ch.string()),
    Labels: ch.array(ch.string()),

    HasError: ch.boolean(),
    HasAnnotation: ch.nullable(ch.boolean()),
    AnnotationIds: ch.array(ch.string()),

    AttributesJson: ch.string(),

    RootSpanStartTimeMs: ch.uint64(),
    TraceNameFromFallback: ch.boolean(),

    OccurredAt: ch.occurredAt(),
    AcceptedAt: ch.acceptedAt(),
    UpdatedAt: ch.writtenAt(),
    _retention_days: ch.uint16(),
  },
});
export type TraceAnalyticsRow = TableRow<typeof traceAnalyticsTable.columns>;

/**
 * Rows with a version below this stamp passed the old write-gate. That gate
 * blocked every dimension-only state, so the whole generation counts as
 * signal. Version stamps are ISO dates. A lexicographic compare orders them
 * correctly.
 */
export const TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT =
  "2026-07-27" as const;

/**
 * Apply this filter in every reader that counts a row here as a trace.
 * Today that is one place: `dedupedSlim` in slim-timeseries-query.ts.
 * Do NOT apply it in the fold read-back.
 *
 * The always-write store puts dimension-only states on this table: a topic,
 * an annotation, a rename, with no span behind them. The old write-gate
 * dropped those states. Without this filter, every aggregate counts such a
 * row as a trace.
 *
 * The doors cover every row generation on the deployed table:
 * - `EarliestSpanStartMs > 0`: any span-bearing row, from either writer.
 *   This fold does not subscribe to log contributions. A row it writes with
 *   no span extent is therefore dimension-only.
 * - `SpanCount > 0` and the reserved log-record-count attribute: only the
 *   retired main-side fold wrote these columns. These doors keep its rows
 *   visible, including logs-only traces.
 * - The version door: it admits every pre-gate-removal row, per above.
 */
export const TRACE_ANALYTICS_HAS_SIGNAL_SQL =
  `(SpanCount > 0` +
  ` OR EarliestSpanStartMs > 0` +
  ` OR Attributes['langwatch.reserved.log_record_count'] NOT IN ('', '0')` +
  ` OR Version < '${TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT}')`;
