/**
 * `evaluation_analytics_rollup`, owned by analytics (goose 00040, replicated 00066): per-bucket
 * evaluation sums by evaluator type and status. AggregatingMergeTree with no version column; each
 * `SimpleAggregateFunction(sum, T)` measure is declared as its `T`.
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

export const evaluationAnalyticsRollup = defineClickHouseTable({
  name: "evaluation_analytics_rollup",
  tenantColumn: "TenantId",
  timeColumn: "BucketStart",
  sortKey: ["TenantId", "BucketStart", "EvaluatorType", "Status"],
  columns: {
    TenantId: column.string(),
    BucketStart: column.dateTime64({ precision: 3 }),
    EvaluatorType: column.lowCardinalityString(),
    Status: column.lowCardinalityString(),
    EvalCount: column.uint64(),
    PassCount: column.uint64(),
    FailCount: column.uint64(),
    ScoreSum: column.float64(),
    ScoreCount: column.uint64(),
  },
});
