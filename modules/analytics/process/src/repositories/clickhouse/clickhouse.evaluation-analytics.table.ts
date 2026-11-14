/**
 * `evaluation_analytics`, owned by analytics (goose 00041, read-back columns 00056): Replacing on
 * UpdatedAt, ordered by (TenantId, OccurredAt, EvaluationId). Reads elect an evaluation's latest
 * version by (TenantId, EvaluationId), as the raw reads did, so that is the sort key here.
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

const moment = () => column.dateTime64({ precision: 3 });

export const evaluationAnalytics = defineClickHouseTable({
  name: "evaluation_analytics",
  tenantColumn: "TenantId",
  timeColumn: "OccurredAt",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "EvaluationId"],
  columns: {
    TenantId: column.string(),
    EvaluationId: column.string(),
    Version: column.lowCardinalityString(),
    OccurredAt: moment(),
    CreatedAt: moment(),
    UpdatedAt: moment(),
    EvaluatorType: column.lowCardinalityString(),
    EvaluatorName: column.nullable(column.string()),
    Status: column.lowCardinalityString(),
    IsGuardrail: column.bool(),
    Passed: column.nullable(column.bool()),
    Score: column.nullable(column.float64()),
    Label: column.nullable(column.string()),
    Model: column.nullable(column.string()),
    TraceId: column.nullable(column.string()),
    UserId: column.nullable(column.string()),
    ConversationId: column.nullable(column.string()),
    CustomerId: column.nullable(column.string()),
    Origin: column.nullable(column.string()),
    DurationMs: column.int64(),
    TotalCost: column.nullable(column.float64()),
    NonBilledCost: column.nullable(column.float64()),
    Attributes: column.stringMap(),
    StartedAt: column.uint64(),
    CompletedAt: column.uint64(),
    AppliedEventIds: column.stringArray(),
  },
});
