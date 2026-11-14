/** `simulation_run_metrics_rollup`, owned by scenario (ADR-202): AggregatingMergeTree, 00081. */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

const occurredAt = column.dateTime64({ precision: 3 });
const roleMap = column.map({ key: column.string(), value: column.float64() });

export const simulationRunMetricsRollup = defineClickHouseTable({
  name: "simulation_run_metrics_rollup",
  tenantColumn: "TenantId",
  sortKey: ["TenantId", "ScenarioRunId", "TraceId"],
  columns: {
    TenantId: column.string(),
    ScenarioRunId: column.string(),
    TraceId: column.string(),
    TotalCost: column.aggregateFunction({ fn: "argMax", args: [column.float64(), occurredAt] }),
    RoleCosts: column.aggregateFunction({ fn: "argMax", args: [roleMap, occurredAt] }),
    RoleLatencies: column.aggregateFunction({ fn: "argMax", args: [roleMap, occurredAt] }),
    OccurredAt: column.aggregateFunction({ fn: "max", args: [occurredAt] }),
    PartitionMonth: column.simpleAggregate({ fn: "max", of: column.uint32() }),
  },
});
