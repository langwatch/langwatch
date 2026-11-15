/**
 * `evaluation_runs`, owned by evaluation and shared to analytics and trace
 * (clickhouse-table-ownership.ts): only the columns analytics' filters and filter options read.
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

export const evaluationRuns = defineClickHouseTable({
  name: "evaluation_runs",
  tenantColumn: "TenantId",
  timeColumn: "ScheduledAt",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "EvaluationId"],
  columns: {
    TenantId: column.string(),
    EvaluationId: column.string(),
    TraceId: column.nullable(column.string()),
    EvaluatorId: column.string(),
    EvaluatorType: column.lowCardinalityString(),
    EvaluatorName: column.nullable(column.string()),
    IsGuardrail: column.uint8(),
    Status: column.lowCardinalityString(),
    Score: column.nullable(column.float64()),
    Passed: column.nullable(column.uint8()),
    Label: column.nullable(column.string()),
    ScheduledAt: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
  },
});
