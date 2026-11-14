/**
 * `simulation_runs`, owned by scenario (ADR-202): ReplacingMergeTree(UpdatedAt) over (TenantId,
 * ScenarioRunId). The nested `Messages.*` and `Evaluations.*` columns and the
 * `Map(String, Array(Float64))` role maps have no descriptor form yet, so they are not declared.
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

export const simulationRuns = defineClickHouseTable({
  name: "simulation_runs",
  tenantColumn: "TenantId",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "ScenarioRunId"],
  columns: {
    ProjectionId: column.string(),
    TenantId: column.string(),
    ScenarioRunId: column.string(),
    ScenarioId: column.string(),
    BatchRunId: column.string(),
    ScenarioSetId: column.string(),
    Version: column.string(),
    Status: column.string(),
    Name: column.nullable(column.string()),
    Description: column.nullable(column.string()),
    Metadata: column.nullable(column.string()),
    TraceIds: column.stringArray(),
    Verdict: column.nullable(column.string()),
    Reasoning: column.nullable(column.string()),
    MetCriteria: column.stringArray(),
    UnmetCriteria: column.stringArray(),
    InconclusiveCriteria: column.stringArray(),
    Error: column.nullable(column.string()),
    DurationMs: column.nullable(column.uint64()),
    TotalCost: column.nullable(column.float64()),
    TraceMetricsJson: column.string(),
    StartedAt: column.dateTime64({ precision: 3 }),
    QueuedAt: column.nullable(column.dateTime64({ precision: 3 })),
    CreatedAt: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
    FinishedAt: column.nullable(column.dateTime64({ precision: 3 })),
    ArchivedAt: column.nullable(column.dateTime64({ precision: 3 })),
    CancellationRequestedAt: column.nullable(column.dateTime64({ precision: 3 })),
    LastSnapshotOccurredAt: column.dateTime64({ precision: 3 }),
    LastEventOccurredAt: column.dateTime64({ precision: 3 }),
    _retention_days: column.uint16(),
    _size_bytes: column.uint32(),
  },
});
