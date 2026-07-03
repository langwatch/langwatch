import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { BaseAnalyticsSlimClickHouseRepository } from "~/server/app-layer/analytics/repositories/analyticsWriteBase";
import type { SimulationAnalyticsRow } from "~/server/event-sourcing/pipelines/simulation-processing/projections/simulationAnalytics.foldProjection";
import type { SimulationAnalyticsRepository } from "./simulation-analytics.repository";

/**
 * ClickHouse write shape for the slim `simulation_analytics` table
 * (ADR-034 Phase 7, migration 00042).
 *
 * The 64-bit-integer column (`DurationMs`) is serialised as a STRING in the
 * JSONEachRow body — JSON numbers can't safely round-trip values past 2^53.
 * Float64 columns stay as numbers.
 */
interface ClickHouseSimulationAnalyticsWriteRecord {
  TenantId: string;
  ScenarioRunId: string;
  Version: string;
  OccurredAt: Date;
  CreatedAt: Date;
  UpdatedAt: Date;

  ScenarioId: string;
  BatchRunId: string;
  ScenarioSetId: string;
  Status: string;
  Verdict: string;

  // Int64 column — stringified for JSON precision.
  DurationMs: string;
  TotalCost: number | null;

  Attributes: Record<string, string>;

  _retention_days: number;
}

function toClickHouseRecord(
  row: SimulationAnalyticsRow,
  retentionDays: number,
): ClickHouseSimulationAnalyticsWriteRecord {
  return {
    TenantId: row.tenantId,
    ScenarioRunId: row.scenarioRunId,
    Version: row.version,
    OccurredAt: new Date(row.occurredAtMs),
    CreatedAt: new Date(row.createdAtMs),
    UpdatedAt: new Date(row.updatedAtMs),

    ScenarioId: row.scenarioId,
    BatchRunId: row.batchRunId,
    ScenarioSetId: row.scenarioSetId,
    Status: row.status,
    Verdict: row.verdict,

    DurationMs: String(Math.round(row.durationMs)),
    TotalCost: row.totalCost,

    Attributes: row.attributes,

    _retention_days: retentionDays,
  };
}

export class SimulationAnalyticsClickHouseRepository
  extends BaseAnalyticsSlimClickHouseRepository<
    SimulationAnalyticsRow,
    ClickHouseSimulationAnalyticsWriteRecord
  >
  implements SimulationAnalyticsRepository
{
  constructor(resolveClient: ClickHouseClientResolver) {
    super(resolveClient, {
      tableName: "simulation_analytics",
      loggerName:
        "langwatch:app-layer:scenarios:simulation-analytics-repository",
      entityIdOf: (row) => ({ scenarioRunId: row.scenarioRunId }),
      toRecord: toClickHouseRecord,
    });
  }
}
