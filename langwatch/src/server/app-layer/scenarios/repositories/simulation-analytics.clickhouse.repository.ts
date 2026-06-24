import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { SimulationAnalyticsRow } from "~/server/event-sourcing/pipelines/simulation-processing/projections/simulationAnalytics.foldProjection";
import { SecurityError } from "~/server/event-sourcing/services/errorHandling";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { createLogger } from "~/utils/logger/server";
import type { SimulationAnalyticsRepository } from "./simulation-analytics.repository";

const TABLE_NAME = "simulation_analytics" as const;

const logger = createLogger(
  "langwatch:app-layer:scenarios:simulation-analytics-repository",
);

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
  implements SimulationAnalyticsRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async upsert(
    row: SimulationAnalyticsRow,
    retentionDays: number = PLATFORM_DEFAULT_RETENTION_DAYS,
  ): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: row.tenantId },
      "SimulationAnalyticsClickHouseRepository.upsert",
    );

    try {
      const client = await this.resolveClient(row.tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: [toClickHouseRecord(row, retentionDays)],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
      });
    } catch (error) {
      logger.error(
        {
          tenantId: row.tenantId,
          scenarioRunId: row.scenarioRunId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to upsert simulation_analytics row into ClickHouse",
      );
      throw error;
    }
  }

  async upsertBatch(
    entries: Array<{ row: SimulationAnalyticsRow; retentionDays?: number }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    const tenantId = entries[0]!.row.tenantId;
    EventUtils.validateTenantId(
      { tenantId },
      "SimulationAnalyticsClickHouseRepository.upsertBatch",
    );
    for (const { row } of entries) {
      if (row.tenantId !== tenantId) {
        throw new SecurityError(
          "SimulationAnalyticsClickHouseRepository.upsertBatch",
          "all rows in a single batch must share the same tenantId",
          tenantId,
          { mismatchedTenantId: row.tenantId },
        );
      }
    }

    try {
      const client = await this.resolveClient(tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: entries.map(({ row, retentionDays }) =>
          toClickHouseRecord(
            row,
            retentionDays ?? PLATFORM_DEFAULT_RETENTION_DAYS,
          ),
        ),
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.error(
        {
          tenantId,
          count: entries.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to batch upsert simulation_analytics rows into ClickHouse",
      );
      throw error;
    }
  }
}
