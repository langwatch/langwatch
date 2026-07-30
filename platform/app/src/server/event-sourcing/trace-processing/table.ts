import {
  ch,
  defineTable,
  replacing,
  type TableRow,
} from "@langwatch/clickhouse";

/**
 * `AcceptedAt` is every table's ADR-099 storage anchor: partition key and TTL
 * anchor. `OccurredAt` is customer-stamped and moves backwards, so it anchors
 * nothing.
 */

/**
 * One row per canonicalized span, and the item table every trace-level total is
 * a query over (ADR-103). The engine key is the span's own identity, so a
 * redelivered span collapses to one row and a `sum()` over the rows is
 * idempotent by construction.
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
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "AcceptedAt" },
  columns: {
    TenantId: ch.string(),
    TraceId: ch.string(),
    /** The fold's own state-shape gate (ADR-098 decision 6). */
    Version: ch.string(),

    TotalDurationMs: ch.uint64(),

    ComputedInput: ch.nullable(ch.string()),
    ComputedOutput: ch.nullable(ch.string()),
    TimeToFirstTokenMs: ch.nullable(ch.uint64()),
    TimeToLastTokenMs: ch.nullable(ch.uint64()),

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
    RootSpanType: ch.nullable(ch.string()),
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
  sortKey: ["TenantId", "TraceId"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "AcceptedAt" },
  columns: {
    TenantId: ch.string(),
    TraceId: ch.string(),
    Version: ch.string(),

    EarliestSpanStartMs: ch.uint64(),
    TotalDurationMs: ch.uint64(),
    TimeToFirstTokenMs: ch.nullable(ch.uint64()),

    TraceName: ch.string(),
    TopicId: ch.nullable(ch.string()),
    SubTopicId: ch.nullable(ch.string()),
    TopicAssignedAt: ch.uint64(),
    TraceNameChangedAt: ch.uint64(),
    UserId: ch.nullable(ch.string()),
    ConversationId: ch.nullable(ch.string()),
    CustomerId: ch.nullable(ch.string()),
    Origin: ch.nullable(ch.string()),
    Models: ch.array(ch.string()),
    Labels: ch.array(ch.string()),

    HasError: ch.boolean(),
    HasAnnotation: ch.boolean(),
    AnnotationIds: ch.array(ch.string()),

    AttributesJson: ch.string(),

    RootSpanStartTimeMs: ch.nullable(ch.uint64()),
    TraceNameFromFallback: ch.boolean(),

    OccurredAt: ch.occurredAt(),
    AcceptedAt: ch.acceptedAt(),
    UpdatedAt: ch.writtenAt(),
    _retention_days: ch.uint16(),
  },
});
export type TraceAnalyticsRow = TableRow<typeof traceAnalyticsTable.columns>;
