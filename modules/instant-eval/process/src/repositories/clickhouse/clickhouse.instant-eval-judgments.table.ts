import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

const moment = () => column.dateTime64({ precision: 3 });

/**
 * `instant_eval_judgments`, owned by instant-eval (goose 00097; trace reads it by a named
 * exception, clickhouse-table-ownership): ReplacingMergeTree(UpdatedAt) over
 * (TenantId, RunId, TraceId, SpanId, QuestionId); CreatedAt partitions it but is no fenced column.
 */
export const instantEvalJudgments = defineClickHouseTable({
  name: "instant_eval_judgments",
  tenantColumn: "TenantId",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "RunId", "TraceId", "SpanId", "QuestionId"],
  columns: {
    TenantId: column.string(),
    RunId: column.string(),
    TraceId: column.string(),
    QuestionId: column.string(),
    ThreadId: column.string(),
    SpanId: column.string(),
    Kind: column.lowCardinality(column.string()),
    Status: column.lowCardinality(column.string()),
    Passed: column.nullable(column.uint8()),
    Score: column.nullable(column.float64()),
    Label: column.string(),
    Probability: column.nullable(column.float64()),
    Probabilities: column.string(),
    Error: column.string(),
    OccurredAt: moment(),
    CreatedAt: moment(),
    UpdatedAt: moment(),
  },
});
