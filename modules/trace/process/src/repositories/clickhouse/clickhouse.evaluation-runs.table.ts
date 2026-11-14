import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

/**
 * Evaluation's runs, a declared share trace reads (clickhouse-table-ownership.ts, evaluation_runs:
 * owner evaluation, readers analytics and trace). Only the columns trace's reads select.
 */
export const evaluationRuns = defineClickHouseTable({
  name: "evaluation_runs",
  tenantColumn: "TenantId",
  timeColumn: "ScheduledAt",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "EvaluationId"],
  columns: {
    TenantId: column.string(),
    EvaluationId: column.string(),
    EvaluatorId: column.string(),
    EvaluatorType: column.lowCardinalityString(),
    EvaluatorName: column.nullable(column.string()),
    TraceId: column.nullable(column.string()),
    IsGuardrail: column.uint8(),
    Status: column.lowCardinalityString(),
    Score: column.nullable(column.float64()),
    Passed: column.nullable(column.uint8()),
    Label: column.nullable(column.string()),
    Details: column.nullable(column.string()),
    Inputs: column.nullable(column.string()),
    Error: column.nullable(column.string()),
    ErrorDetails: column.nullable(column.string()),
    CreatedAt: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
    ArchivedAt: column.nullable(column.dateTime64({ precision: 3 })),
    ScheduledAt: column.dateTime64({ precision: 3 }),
    StartedAt: column.nullable(column.dateTime64({ precision: 3 })),
    CompletedAt: column.nullable(column.dateTime64({ precision: 3 })),
    CostId: column.nullable(column.string()),
    Attempts: column.uint16(),
    LastAttemptAt: column.nullable(column.dateTime64({ precision: 3 })),
    LastAttemptError: column.nullable(column.string()),
    NextAttemptAt: column.nullable(column.dateTime64({ precision: 3 })),
    LastEventOccurredAt: column.dateTime64({ precision: 3 }),
  },
});
