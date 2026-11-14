/**
 * `experiment_runs`, owned by experiment (goose 00002, clickhouse-table-ownership):
 * ReplacingMergeTree(UpdatedAt) over (TenantId, RunId, ExperimentId), partitioned by StartedAt.
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

const moment = () => column.dateTime64({ precision: 3 });

export const experimentRuns = defineClickHouseTable({
  name: "experiment_runs",
  tenantColumn: "TenantId",
  timeColumn: "StartedAt",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "RunId", "ExperimentId"],
  columns: {
    ProjectionId: column.string(),
    TenantId: column.string(),
    RunId: column.string(),
    ExperimentId: column.string(),
    WorkflowVersionId: column.nullable(column.string()),
    Version: column.string(),
    Total: column.uint32(),
    Progress: column.uint32(),
    CompletedCount: column.uint32(),
    FailedCount: column.uint32(),
    TotalCost: column.nullable(column.float64()),
    TotalDurationMs: column.nullable(column.uint64()),
    AvgScoreBps: column.nullable(column.int32()),
    PassRateBps: column.nullable(column.uint32()),
    Targets: column.string(),
    TotalScoreSum: column.float64(),
    ScoreCount: column.uint32(),
    PassedCount: column.uint32(),
    GradedCount: column.uint32(),
    CreatedAt: moment(),
    UpdatedAt: moment(),
    StartedAt: moment(),
    FinishedAt: column.nullable(moment()),
    StoppedAt: column.nullable(moment()),
    LastProcessedEventId: column.string(),
    LastEventOccurredAt: moment(),
    ExpectedTargetResults: column.nullable(column.uint32()),
    ExpectedEvaluatorResults: column.nullable(column.uint32()),
    Concurrency: column.nullable(column.uint16()),
  },
});
