import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

/**
 * Scenario's runs, read by trace's scenario filters only (clickhouse-table-ownership.ts, a named
 * exception): the columns those filters read. ReplacingMergeTree(UpdatedAt) over (TenantId,
 * ScenarioRunId), partitioned by StartedAt, as the owner's descriptor states.
 */
export const simulationRuns = defineClickHouseTable({
  name: "simulation_runs",
  tenantColumn: "TenantId",
  versionColumn: "UpdatedAt",
  timeColumn: "StartedAt",
  sortKey: ["TenantId", "ScenarioRunId"],
  columns: {
    TenantId: column.string(),
    ScenarioRunId: column.string(),
    ScenarioId: column.string(),
    BatchRunId: column.string(),
    ScenarioSetId: column.string(),
    Status: column.string(),
    Verdict: column.nullable(column.string()),
    StartedAt: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
  },
});
