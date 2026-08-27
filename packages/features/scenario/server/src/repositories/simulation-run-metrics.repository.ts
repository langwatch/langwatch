import type { SimulationRunMetricsProjectionRecord } from "../projections/simulation-run-metrics.projection";

export abstract class SimulationRunMetricsRepository {
  abstract insertRow(row: SimulationRunMetricsProjectionRecord): Promise<void>;
  abstract insertRows(rows: SimulationRunMetricsProjectionRecord[]): Promise<void>;
}
