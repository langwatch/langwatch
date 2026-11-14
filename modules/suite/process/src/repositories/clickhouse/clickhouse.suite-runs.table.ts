/** `suite_runs`, owned by suite (ADR-202): ReplacingMergeTree(UpdatedAt) over its sort key. */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

export const suiteRuns = defineClickHouseTable({
  name: "suite_runs",
  tenantColumn: "TenantId",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "ScenarioSetId", "BatchRunId"],
  columns: {
    ProjectionId: column.string(),
    TenantId: column.string(),
    SuiteRunId: column.string(),
    BatchRunId: column.string(),
    ScenarioSetId: column.string(),
    SuiteId: column.string(),
    Version: column.string(),
    Status: column.string(),
    Total: column.uint32(),
    StartedCount: column.uint32(),
    CompletedCount: column.uint32(),
    FailedCount: column.uint32(),
    Progress: column.uint32(),
    PassRateBps: column.nullable(column.int32()),
    PassedCount: column.uint32(),
    GradedCount: column.uint32(),
    CreatedAt: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
    StartedAt: column.dateTime64({ precision: 3 }),
    FinishedAt: column.nullable(column.dateTime64({ precision: 3 })),
    LastEventOccurredAt: column.dateTime64({ precision: 3 }),
    _retention_days: column.uint16(),
    _size_bytes: column.uint32(),
  },
});
