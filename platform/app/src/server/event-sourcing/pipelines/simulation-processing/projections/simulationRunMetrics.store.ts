import type {
  AppendStore,
  BulkAppendContext,
} from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type { SimulationRunMetricsRepository } from "../repositories/simulationRunMetrics.clickhouse.repository";
import type { SimulationRunMetricsProjectionRecord } from "./simulationRunMetrics.mapProjection";

/**
 * AppendStore adapter for the simulationRunMetrics map projection.
 *
 * Deliberately does NOT extend BaseAnalyticsRollupAppendStore: that base
 * resolves per-tenant retention and stamps `_retention_days`, but
 * `simulation_run_metrics` has no retention/TTL column yet (migration
 * 00078), so there is nothing to stamp. Tenant routing happens inside the
 * repository, which resolves the ClickHouse client from the record's own
 * TenantId (bulk appends are tenant-scoped per the BulkAppendContext
 * contract).
 */
export class SimulationRunMetricsAppendStore
  implements AppendStore<SimulationRunMetricsProjectionRecord>
{
  constructor(private readonly repository: SimulationRunMetricsRepository) {}

  async append(
    record: SimulationRunMetricsProjectionRecord,
    _context: ProjectionStoreContext,
  ): Promise<void> {
    await this.repository.insertRow(record);
  }

  async bulkAppend(
    records: SimulationRunMetricsProjectionRecord[],
    _context: BulkAppendContext,
  ): Promise<void> {
    await this.repository.insertRows(records);
  }
}
