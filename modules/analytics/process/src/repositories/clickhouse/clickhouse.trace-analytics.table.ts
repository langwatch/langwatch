/**
 * `trace_analytics`, owned by trace, shared to analytics (clickhouse-table-ownership.ts): only
 * the columns analytics' recency and slim series reads name. It elects a trace's latest version by
 * (TenantId, TraceId); trace's own descriptor keys on the engine's ORDER BY instead.
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

export const traceAnalytics = defineClickHouseTable({
  name: "trace_analytics",
  tenantColumn: "TenantId",
  timeColumn: "OccurredAt",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "TraceId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    Version: column.lowCardinalityString(),
    OccurredAt: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
    Origin: column.string(),
    TraceName: column.string(),
    TopicId: column.nullable(column.string()),
    SubTopicId: column.nullable(column.string()),
    UserId: column.nullable(column.string()),
    ConversationId: column.nullable(column.string()),
    CustomerId: column.nullable(column.string()),
    Labels: column.stringArray(),
    TotalCost: column.nullable(column.float64()),
    NonBilledCost: column.nullable(column.float64()),
    TotalDurationMs: column.int64(),
    TimeToFirstTokenMs: column.nullable(column.uint32()),
    TokensPerSecond: column.nullable(column.uint32()),
    PromptTokens: column.nullable(column.uint32()),
    CompletionTokens: column.nullable(column.uint32()),
    CacheReadTokens: column.nullable(column.uint32()),
    CacheWriteTokens: column.nullable(column.uint32()),
    ReasoningTokens: column.nullable(column.uint32()),
    HasError: column.bool(),
    Attributes: column.stringMap(),
    SpanCount: column.uint32(),
    EarliestSpanStartMs: column.uint64(),
  },
});
