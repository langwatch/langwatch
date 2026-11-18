/**
 * `evaluation_runs`, owned by evaluation (ADR-202; shared for reading with analytics and trace,
 * clickhouse-table-ownership): ReplacingMergeTree(UpdatedAt) over (TenantId, EvaluationId),
 * partitioned by ScheduledAt, so the fence windows on ScheduledAt.
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

const moment = () => column.dateTime64({ precision: 3 });

export const evaluationRuns = defineClickHouseTable({
  name: "evaluation_runs",
  tenantColumn: "TenantId",
  timeColumn: "ScheduledAt",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "EvaluationId"],
  columns: {
    ProjectionId: column.string(),
    TenantId: column.string(),
    EvaluationId: column.string(),
    Version: column.string(),
    EvaluatorId: column.string(),
    EvaluatorType: column.lowCardinality(column.string()),
    EvaluatorName: column.nullable(column.string()),
    TraceId: column.nullable(column.string()),
    IsGuardrail: column.uint8(),
    Status: column.lowCardinality(column.string()),
    Score: column.nullable(column.float64()),
    Passed: column.nullable(column.uint8()),
    Label: column.nullable(column.string()),
    Details: column.nullable(column.string()),
    Inputs: column.nullable(column.string()),
    Error: column.nullable(column.string()),
    ErrorDetails: column.nullable(column.string()),
    CreatedAt: moment(),
    UpdatedAt: moment(),
    ArchivedAt: column.nullable(moment()),
    ScheduledAt: moment(),
    StartedAt: column.nullable(moment()),
    CompletedAt: column.nullable(moment()),
    CostId: column.nullable(column.string()),
    LastProcessedEventId: column.string(),
    LastEventOccurredAt: moment(),
    Attempts: column.uint16(),
    LastAttemptAt: column.nullable(moment()),
    LastAttemptError: column.nullable(column.string()),
    NextAttemptAt: column.nullable(moment()),
    /** Goose 00131: the KSUID layout of ProjectionId; NULL on rows written before it. */
    IdLayout: column.nullable(column.lowCardinalityString()),
    _retention_days: column.uint16(),
    _size_bytes: column.uint32(),
  },
});
