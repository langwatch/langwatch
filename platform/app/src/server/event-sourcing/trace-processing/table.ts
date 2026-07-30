import { ch, defineTable, replacing, type ColumnDef } from "@langwatch/clickhouse";

/**
 * `AcceptedAt` is both tables' ADR-099 storage anchor: partition key, TTL
 * anchor, and frozen once per trace. `OccurredAt` is customer-stamped and
 * moves backwards, so it anchors nothing.
 */

function smallUint(bits: 8 | 16 | 32): ColumnDef<number> {
  const chType = `UInt${bits}`;
  const max = 2 ** bits - 1;
  const schema = ch.float64().schema.refine(
    (value) => Number.isInteger(value) && value >= 0 && value <= max,
    (value) => ({ message: `"${String(value)}" is not a valid ${chType} wire value` }),
  );
  return {
    chType,
    schema,
    decode: (cell: unknown) => schema.parse(cell),
    encode: (value: number) => value,
    frozen: false,
    platformControlled: false,
    nullable: false,
  };
}

const lowCardinalityString = () => ch.lowCardinality(ch.string());
const jsonText = () => ch.string(); // JSON payload carried as a plain String column, per ADR-099's "The codec is positional and compiled".

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
    /** The fold's own state-version gate (ADR-098 decision 6). */
    Version: ch.string(),

    SpanCount: ch.uint64(),
    DerivationCapped: ch.boolean(),
    TotalDurationMs: ch.uint64(),

    ComputedInput: ch.nullable(ch.string()),
    ComputedOutput: ch.nullable(ch.string()),
    TimeToFirstTokenMs: ch.nullable(ch.uint64()),
    TimeToLastTokenMs: ch.nullable(ch.uint64()),
    TokensPerSecond: ch.nullable(ch.uint64()),

    ContainsErrorStatus: ch.boolean(),
    ContainsOKStatus: ch.boolean(),
    ErrorMessage: ch.nullable(ch.string()),

    Models: ch.array(ch.string()),

    TotalCost: ch.nullable(ch.float64()),
    NonBilledCost: ch.nullable(ch.float64()),
    HasTokenUsage: ch.boolean(),
    TokensEstimated: ch.boolean(),
    TotalPromptTokenCount: ch.nullable(ch.uint64()),
    TotalCompletionTokenCount: ch.nullable(ch.uint64()),

    BlockedByGuardrail: ch.boolean(),
    ContainsAi: ch.boolean(),
    ContainsPrompt: ch.boolean(),
    SelectedPromptId: ch.nullable(ch.string()),
    SelectedPromptVersionId: ch.nullable(ch.string()),
    LastUsedPromptId: ch.nullable(ch.string()),
    LastUsedPromptVersionId: ch.nullable(ch.string()),

    TraceName: ch.string(),
    RootSpanType: ch.nullable(lowCardinalityString()),
    RootSpanStartTimeMs: ch.nullable(ch.uint64()),
    TraceNameFromFallback: ch.boolean(),

    TopicId: ch.nullable(ch.string()),
    SubTopicId: ch.nullable(ch.string()),

    AnnotationIds: ch.array(ch.string()),

    /** The full, un-flattened attribute bag, JSON-encoded. */
    AttributesJson: jsonText(),

    OccurredAt: ch.occurredAt(),
    /** This table's own ADR-099 anchor — see the module docblock. */
    AcceptedAt: ch.acceptedAt(),
    UpdatedAt: ch.writtenAt(),
    _retention_days: smallUint(16),
  },
});
export type TraceSummariesRow = ReturnType<typeof traceSummariesTable.rowSchema.parse>;

export const traceAnalyticsTable = defineTable({
  name: "trace_analytics",
  merge: replacing({ version: "UpdatedAt" }),
  sortKey: ["TenantId", "AcceptedAt", "TraceId"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  ttl: { anchor: "AcceptedAt" },
  columns: {
    TenantId: ch.string(),
    TraceId: ch.string(),
    Version: ch.string(),

    /** The fold's own frozen storage anchor (`traceAnalytics.ts`'s `storageAnchorMs`). */
    AcceptedAt: ch.acceptedAt(),
    EarliestSpanStartMs: ch.uint64(),

    SpanCount: ch.uint64(),
    DerivationCapped: ch.boolean(),

    TraceName: ch.string(),
    TopicId: ch.nullable(ch.string()),
    SubTopicId: ch.nullable(ch.string()),
    UserId: ch.nullable(ch.string()),
    ConversationId: ch.nullable(ch.string()),
    CustomerId: ch.nullable(ch.string()),
    Origin: ch.nullable(lowCardinalityString()),
    Models: ch.array(ch.string()),
    Labels: ch.array(ch.string()),

    TotalCost: ch.nullable(ch.float64()),
    NonBilledCost: ch.nullable(ch.float64()),
    TotalDurationMs: ch.uint64(),
    TimeToFirstTokenMs: ch.nullable(ch.uint64()),
    TokensPerSecond: ch.nullable(ch.uint64()),
    PromptTokens: ch.uint64(),
    CompletionTokens: ch.uint64(),
    CacheReadTokens: ch.uint64(),
    CacheWriteTokens: ch.uint64(),
    ReasoningTokens: ch.uint64(),

    HasError: ch.boolean(),
    HasAnnotation: ch.boolean(),
    AnnotationIds: ch.array(ch.string()),

    AttributesJson: jsonText(),

    /** Read-back-only columns — exist so `store.read()` can reconstruct the
     * fold's accumulator from a plain row, per ADR-098 decision 3 ("a fold
     * that needs continuity earns it by persisting enough typed state to
     * reconstruct its accumulator"). Never a dimension anyone filters on. */
    RootSpanStartTimeMs: ch.nullable(ch.uint64()),
    TraceNameFromFallback: ch.boolean(),

    OccurredAt: ch.occurredAt(),
    UpdatedAt: ch.writtenAt(),
    _retention_days: smallUint(16),
  },
});
export type TraceAnalyticsRow = ReturnType<typeof traceAnalyticsTable.rowSchema.parse>;
