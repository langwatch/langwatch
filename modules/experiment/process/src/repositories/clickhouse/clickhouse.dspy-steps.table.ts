/**
 * `dspy_steps`, owned by experiment (goose 00005, clickhouse-table-ownership):
 * ReplacingMergeTree(UpdatedAt) over (TenantId, ExperimentId, RunId, StepIndex),
 * partitioned by CreatedAt (not a fence time column, so no `timeColumn`).
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

const moment = () => column.dateTime64({ precision: 3 });

export const dspySteps = defineClickHouseTable({
  name: "dspy_steps",
  tenantColumn: "TenantId",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "ExperimentId", "RunId", "StepIndex"],
  columns: {
    Id: column.string(),
    TenantId: column.string(),
    ExperimentId: column.string(),
    RunId: column.string(),
    StepIndex: column.string(),
    WorkflowVersionId: column.nullable(column.string()),
    Score: column.float64(),
    Label: column.string(),
    OptimizerName: column.string(),
    OptimizerParameters: column.string(),
    Predictors: column.string(),
    Examples: column.string(),
    LlmCalls: column.string(),
    LlmCallsTotal: column.uint32(),
    LlmCallsTotalTokens: column.uint64(),
    LlmCallsTotalCost: column.float64(),
    CreatedAt: moment(),
    InsertedAt: moment(),
    UpdatedAt: moment(),
    _size_bytes: column.uint32(),
  },
});
