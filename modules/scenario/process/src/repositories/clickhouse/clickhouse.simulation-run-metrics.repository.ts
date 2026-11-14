import {
  clickhouseRead,
  fn,
  type ReaderReadStatement,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import { classifyClickHouseError, StoreError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";

import type { SimulationRunMetricsProjectionRecord } from "../../eventing/simulation-run-metrics.projection.ts";
import type { SimulationRunMetricsRepository } from "../simulation-run-metrics.repository.ts";
import { simulationRunMetricsRollup } from "./clickhouse.simulation-run-metrics-rollup.table.ts";
import type { SimulationEventingClickHouseResolver } from "./clickhouse.simulation-session.store.ts";

const TABLE_NAME = "simulation_run_metrics" as const;

const logger = createLogger("langwatch:simulation-processing:run-metrics-repository");

type WithDateWrites<RecordType, DateKeys extends keyof RecordType> = Omit<RecordType, DateKeys> & {
  [Key in DateKeys]: Date | null;
};

type SimulationMetricsClickHouseClientResolver = SimulationEventingClickHouseResolver;

type ClickHouseSimulationRunMetricsWriteRecord = WithDateWrites<
  SimulationRunMetricsProjectionRecord,
  "OccurredAt"
>;

type SimulationRunMetricsRollupRow = {
  totalCost: number | string;
  roleCosts: Record<string, number>;
  roleLatencies: Record<string, number>;
};

/** Aggregated metrics for one simulation run, rolled up across its traces. */
interface SimulationRunMetricsRollup {
  totalCost: number;
  roleCosts: Record<string, number>;
  roleLatencies: Record<string, number>;
}

export class ClickHouseSimulationRunMetricsRepository implements SimulationRunMetricsRepository {
  static create(
    resolveClient: SimulationMetricsClickHouseClientResolver,
  ): ClickHouseSimulationRunMetricsRepository {
    return new ClickHouseSimulationRunMetricsRepository(resolveClient);
  }

  constructor(private readonly resolveClient: SimulationMetricsClickHouseClientResolver) {}

  async insertRow(row: SimulationRunMetricsProjectionRecord): Promise<void> {
    await this.insertRows([row]);
  }

  async insertRows(rows: SimulationRunMetricsProjectionRecord[]): Promise<void> {
    const [firstRow] = rows;
    if (!firstRow) return;

    // Map-projection batches are tenant-scoped; TenantId chooses the ClickHouse for the batch.
    // A mixed-tenant batch would land one tenant's rows in another's database (worth checking).
    const tenantId = firstRow.TenantId;
    const foreign = rows.find((row) => row.TenantId !== tenantId);
    if (foreign) {
      throw new Error(
        `simulation_run_metrics batch mixes tenants (${tenantId} and ${foreign.TenantId}); refusing to write`,
      );
    }

    const values: ClickHouseSimulationRunMetricsWriteRecord[] = rows.map((row) => ({
      ...row,
      OccurredAt: new Date(row.OccurredAt),
    }));

    try {
      const client = await this.resolveClient(tenantId);
      await client.insert({
        table: TABLE_NAME,
        values,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(
        { tenantId, count: rows.length, error: errorMessage },
        "Failed to insert simulation run metrics into ClickHouse",
      );
      throw new StoreError({
        operation: "insertRows",
        store: "SimulationRunMetricsRepositoryClickHouse",
        message: `Failed to insert ${rows.length} simulation run metrics rows: ${errorMessage}`,
        category: classifyClickHouseError(error),
        context: { count: rows.length },
        cause: error,
      });
    }
  }

  /** One run's totals: argMax collapses retry duplicates per trace, sumMap adds the roles. */
  static runMetricsRead({
    tenantId,
    scenarioRunId,
  }: {
    tenantId: string;
    scenarioRunId: string;
  }): ReaderReadStatement<SimulationRunMetricsRollupRow> {
    const scope = tenantScope.single({ tenantId });
    const rollup = simulationRunMetricsRollup;
    const latest = clickhouseRead({ scope })
      .from(rollup)
      .select({
        trace: rollup.TraceId,
        cost: fn.argMaxMerge(rollup.TotalCost),
        costs: fn.argMaxMerge(rollup.RoleCosts),
        latencies: fn.argMaxMerge(rollup.RoleLatencies),
      })
      .where(({ eq }) => eq(rollup.ScenarioRunId, scenarioRunId))
      .groupBy(rollup.TraceId)
      .as("latest");
    const summed = (map: typeof latest.costs | typeof latest.latencies) => {
      const sums = fn.sumMap(fn.mapKeys(map), fn.mapValues(map));
      return fn.mapFromArrays(fn.tupleElement(sums, "0"), fn.tupleElement(sums, "1"));
    };
    return clickhouseRead({ scope })
      .from(latest)
      .select({
        totalCost: fn.sum(latest.cost),
        roleCosts: summed(latest.costs),
        roleLatencies: summed(latest.latencies),
      })
      .build();
  }

  /**
   * Future read path (not yet wired into services): aggregates per-trace
   * metric rows for a run via the dedupe-safe rollup (migration 00079) —
   * argMax collapses retry duplicates per trace, then rolls up to run totals.
   */
  async getRunMetrics(params: {
    tenantId: string;
    scenarioRunId: string;
  }): Promise<SimulationRunMetricsRollup> {
    const { tenantId, scenarioRunId } = params;

    try {
      const client = await this.resolveClient(tenantId);
      const { rows } = await client.read({
        statement: ClickHouseSimulationRunMetricsRepository.runMetricsRead({
          tenantId,
          scenarioRunId,
        }),
        table: simulationRunMetricsRollup.$table.name,
      });
      const row = rows[0];

      // Aggregates without GROUP BY always return one row; an empty run
      // yields zeros and empty maps.
      return {
        totalCost: Number(row?.totalCost ?? 0),
        roleCosts: row?.roleCosts ?? {},
        roleLatencies: row?.roleLatencies ?? {},
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(
        { tenantId, scenarioRunId, error: errorMessage },
        "Failed to read simulation run metrics from ClickHouse",
      );
      throw new StoreError({
        operation: "getRunMetrics",
        store: "SimulationRunMetricsRepositoryClickHouse",
        message: `Failed to read metrics for scenario run ${scenarioRunId}: ${errorMessage}`,
        category: classifyClickHouseError(error),
        context: { scenarioRunId },
        cause: error,
      });
    }
  }
}
