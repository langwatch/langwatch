/**
 * `experiment_run_items`, owned by experiment (goose 00002, clickhouse-table-ownership):
 * ReplacingMergeTree(OccurredAt) over (TenantId, RunId, ProjectionId), partitioned by OccurredAt.
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

const moment = () => column.dateTime64({ precision: 3 });

export const experimentRunItems = defineClickHouseTable({
  name: "experiment_run_items",
  tenantColumn: "TenantId",
  timeColumn: "OccurredAt",
  versionColumn: "OccurredAt",
  sortKey: ["TenantId", "RunId", "ProjectionId"],
  columns: {
    ProjectionId: column.string(),
    TenantId: column.string(),
    RunId: column.string(),
    ExperimentId: column.string(),
    RowIndex: column.uint32(),
    TargetId: column.string(),
    ResultType: column.lowCardinality(column.string()),
    DatasetEntry: column.string(),
    Predicted: column.nullable(column.string()),
    TargetCost: column.nullable(column.float64()),
    TargetDurationMs: column.nullable(column.uint32()),
    TargetError: column.nullable(column.string()),
    TargetDomainError: column.nullable(column.string()),
    TraceId: column.nullable(column.string()),
    EvaluatorId: column.nullable(column.string()),
    EvaluatorName: column.nullable(column.string()),
    EvaluationStatus: column.lowCardinality(column.string()),
    Score: column.nullable(column.float64()),
    Label: column.nullable(column.string()),
    Passed: column.nullable(column.uint8()),
    EvaluationDetails: column.nullable(column.string()),
    EvaluationCost: column.nullable(column.float64()),
    EvaluationInputs: column.nullable(column.string()),
    EvaluationDurationMs: column.nullable(column.uint32()),
    CarriedOver: column.uint8(),
    CreatedAt: moment(),
    OccurredAt: moment(),
    _size_bytes: column.uint32(),
  },
});
