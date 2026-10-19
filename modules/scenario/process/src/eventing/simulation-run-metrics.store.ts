import type { AppendStore, BulkAppendContext, ProjectionStoreContext } from "@langwatch/eventing";

import type { SimulationRunMetricsRepository } from "../repositories/simulation-run-metrics.repository.ts";
import type { SimulationRunMetricsProjectionRecord } from "./simulation-run-metrics.projection.ts";

/**
 * AppendStore adapter for simulationRunMetrics; skips BaseAnalyticsRollupAppendStore.
 * No retention/TTL column yet (nothing to stamp). Tenant routing is in repository.
 */
export class SimulationRunMetricsAppendStore implements AppendStore<SimulationRunMetricsProjectionRecord> {
  static create(repository: SimulationRunMetricsRepository): SimulationRunMetricsAppendStore {
    return new SimulationRunMetricsAppendStore(repository);
  }

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
