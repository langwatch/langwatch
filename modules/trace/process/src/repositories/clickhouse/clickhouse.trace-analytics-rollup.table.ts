import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

/**
 * Trace's per-bucket rollup (goose 00038), an AggregatingMergeTree with no version column.
 * Each measure is a `SimpleAggregateFunction` holding a plain value, declared as that value.
 */
export const traceAnalyticsRollup = defineClickHouseTable({
  name: "trace_analytics_rollup",
  tenantColumn: "TenantId",
  timeColumn: "BucketStart",
  sortKey: ["TenantId", "BucketStart", "Model", "SpanType"],
  columns: {
    TenantId: column.string(),
    BucketStart: column.dateTime64({ precision: 3 }),
    Model: column.lowCardinalityString(),
    SpanType: column.lowCardinalityString(),
    SpanCount: column.uint64(),
    TraceCount: column.uint64(),
    ErrorCount: column.uint64(),
    CostSum: column.float64(),
    NonBilledCostSum: column.float64(),
    DurationSum: column.int64(),
    PromptTokensSum: column.uint64(),
    CompletionTokensSum: column.uint64(),
    CacheReadTokensSum: column.uint64(),
    CacheWriteTokensSum: column.uint64(),
    ReasoningTokensSum: column.uint64(),
  },
});
