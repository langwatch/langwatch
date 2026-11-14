/** `simulation_run_metrics`, owned by scenario (ADR-202): ReplacingMergeTree(OccurredAt), 00080. */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

export const simulationRunMetrics = defineClickHouseTable({
  name: "simulation_run_metrics",
  tenantColumn: "TenantId",
  timeColumn: "OccurredAt",
  versionColumn: "OccurredAt",
  sortKey: ["TenantId", "ScenarioRunId", "TraceId"],
  columns: {
    TenantId: column.string(),
    ScenarioRunId: column.string(),
    TraceId: column.string(),
    TotalCost: column.float64(),
    RoleCosts: column.map({ key: column.string(), value: column.float64() }),
    RoleLatencies: column.map({ key: column.string(), value: column.float64() }),
    OccurredAt: column.dateTime64({ precision: 3 }),
    EventId: column.string(),
  },
});
