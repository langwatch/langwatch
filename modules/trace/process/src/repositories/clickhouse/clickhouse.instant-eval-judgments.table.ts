import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

/**
 * Instant-eval's judgements, read by trace's `eval` filters only (clickhouse-table-ownership.ts, a
 * named exception): the columns those filters read. ReplacingMergeTree(UpdatedAt) over (TenantId,
 * RunId, TraceId, SpanId, QuestionId); CreatedAt partitions it and bounds a share (Decided 27).
 */
export const instantEvalJudgments = defineClickHouseTable({
  name: "instant_eval_judgments",
  tenantColumn: "TenantId",
  versionColumn: "UpdatedAt",
  timeColumn: "CreatedAt",
  sortKey: ["TenantId", "RunId", "TraceId", "SpanId", "QuestionId"],
  columns: {
    TenantId: column.string(),
    RunId: column.string(),
    TraceId: column.string(),
    QuestionId: column.string(),
    ThreadId: column.string(),
    SpanId: column.string(),
    Passed: column.nullable(column.uint8()),
    CreatedAt: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
  },
});
