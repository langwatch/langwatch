import { createLogger } from "@langwatch/observability";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { WithDateWrites } from "~/server/clickhouse/types";
import {
  classifyClickHouseError,
  StoreError,
} from "~/server/event-sourcing/services/errorHandling";
import type { SimulationRunMetricsProjectionRecord } from "../projections/simulationRunMetrics.mapProjection";

const TABLE_NAME = "simulation_run_metrics" as const;
const ROLLUP_TABLE_NAME = "simulation_run_metrics_rollup" as const;

const logger = createLogger(
  "langwatch:simulation-processing:run-metrics-repository",
);

type ClickHouseSimulationRunMetricsWriteRecord = WithDateWrites<
  SimulationRunMetricsProjectionRecord,
  "OccurredAt"
>;

interface ClickHouseSimulationRunMetricsRollupRow {
  TotalCost: number;
  RoleCosts: Record<string, number>;
  RoleLatencies: Record<string, number>;
}

/** Aggregated metrics for one simulation run, rolled up across its traces. */
export interface SimulationRunMetricsRollup {
  totalCost: number;
  roleCosts: Record<string, number>;
  roleLatencies: Record<string, number>;
}

/**
 * Write side of the `simulation_run_metrics` AppendStore: insert-only, one
 * row per metrics_computed event. The table has no `_retention_days` column
 * (migration 00078), so no retention is stamped on write.
 */
export interface SimulationRunMetricsRepository {
  insertRow(row: SimulationRunMetricsProjectionRecord): Promise<void>;
  insertRows(rows: SimulationRunMetricsProjectionRecord[]): Promise<void>;
}

export class SimulationRunMetricsRepositoryClickHouse
  implements SimulationRunMetricsRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async insertRow(row: SimulationRunMetricsProjectionRecord): Promise<void> {
    await this.insertRows([row]);
  }

  async insertRows(
    rows: SimulationRunMetricsProjectionRecord[],
  ): Promise<void> {
    const [firstRow] = rows;
    if (!firstRow) return;

    // Map-projection batches are tenant-scoped, so every row in one call
    // carries the same TenantId (stamped on the record itself, per the
    // BulkAppendContext contract).
    //
    // This one value chooses the ClickHouse the whole batch is written to, so
    // a batch that ever broke that invariant would land one tenant's rows in
    // another tenant's database. Cheap to check, and the only alternative is
    // trusting a comment. A plain Error on purpose: it is a broken internal
    // invariant, not something a caller can act on.
    const tenantId = firstRow.TenantId;
    const foreign = rows.find((row) => row.TenantId !== tenantId);
    if (foreign) {
      throw new Error(
        `simulation_run_metrics batch mixes tenants (${tenantId} and ${foreign.TenantId}); refusing to write`,
      );
    }

    const values: ClickHouseSimulationRunMetricsWriteRecord[] = rows.map(
      (row) => ({
        ...row,
        OccurredAt: new Date(row.OccurredAt),
      }),
    );

    try {
      const client = await this.resolveClient(tenantId);
      await client.insert({
        table: TABLE_NAME,
        values,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.warn(
        { tenantId, count: rows.length, error: errorMessage },
        "Failed to insert simulation run metrics into ClickHouse",
      );
      throw new StoreError(
        "insertRows",
        "SimulationRunMetricsRepositoryClickHouse",
        `Failed to insert ${rows.length} simulation run metrics rows: ${errorMessage}`,
        classifyClickHouseError(error),
        { count: rows.length },
        error,
      );
    }
  }

  /**
   * Future read path (not yet wired into services): aggregates all per-trace
   * metric rows for a run. Reads the dedupe-safe rollup (migration 00079):
   * the inner query merges each trace's argMax states (retry duplicates —
   * same EventId/OccurredAt — collapse to one value, whether or not the
   * AggregatingMergeTree parts have merged); the outer query rolls traces up
   * into run-level totals with per-role map sums.
   */
  async getRunMetrics(params: {
    tenantId: string;
    scenarioRunId: string;
  }): Promise<SimulationRunMetricsRollup> {
    const { tenantId, scenarioRunId } = params;

    try {
      const client = await this.resolveClient(tenantId);
      const result = await client.query({
        query: `
          SELECT
            sum(TotalCost) AS TotalCost,
            mapFromArrays(
              sumMap(mapKeys(RoleCosts), mapValues(RoleCosts)).1,
              sumMap(mapKeys(RoleCosts), mapValues(RoleCosts)).2
            ) AS RoleCosts,
            mapFromArrays(
              sumMap(mapKeys(RoleLatencies), mapValues(RoleLatencies)).1,
              sumMap(mapKeys(RoleLatencies), mapValues(RoleLatencies)).2
            ) AS RoleLatencies
          FROM (
            SELECT
              TraceId,
              argMaxMerge(TotalCost) AS TotalCost,
              argMaxMerge(RoleCosts) AS RoleCosts,
              argMaxMerge(RoleLatencies) AS RoleLatencies
            FROM ${ROLLUP_TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND ScenarioRunId = {scenarioRunId:String}
            GROUP BY TraceId
          )
        `,
        query_params: { tenantId, scenarioRunId },
        format: "JSONEachRow",
      });

      const rows = await result.json<ClickHouseSimulationRunMetricsRollupRow>();
      const row = rows[0];

      // Aggregates without GROUP BY always return one row; an empty run
      // yields zeros and empty maps.
      return {
        totalCost: row?.TotalCost ?? 0,
        roleCosts: row?.RoleCosts ?? {},
        roleLatencies: row?.RoleLatencies ?? {},
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.warn(
        { tenantId, scenarioRunId, error: errorMessage },
        "Failed to read simulation run metrics from ClickHouse",
      );
      throw new StoreError(
        "getRunMetrics",
        "SimulationRunMetricsRepositoryClickHouse",
        `Failed to read metrics for scenario run ${scenarioRunId}: ${errorMessage}`,
        classifyClickHouseError(error),
        { scenarioRunId },
        error,
      );
    }
  }
}
