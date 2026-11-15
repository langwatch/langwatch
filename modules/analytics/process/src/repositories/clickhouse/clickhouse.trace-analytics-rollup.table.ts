/**
 * `trace_analytics_rollup`, owned by trace, shared to analytics (clickhouse-table-ownership.ts):
 * the bucket and the sums analytics' rollup series read. AggregatingMergeTree with no version
 * column; each `SimpleAggregateFunction(sum, T)` measure is declared as its `T`.
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

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
    TraceCount: column.uint64(),
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
