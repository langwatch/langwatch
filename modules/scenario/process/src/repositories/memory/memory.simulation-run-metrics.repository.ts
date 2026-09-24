import type { SimulationRunMetricsProjectionRecord } from "../../eventing/simulation-run-metrics.projection.ts";
import { SimulationRunMetricsRepository } from "../simulation-run-metrics.repository.ts";

export class MemorySimulationRunMetricsRepository extends SimulationRunMetricsRepository {
  readonly rows: SimulationRunMetricsProjectionRecord[] = [];

  private constructor() {
    super();
  }

  static create(): MemorySimulationRunMetricsRepository {
    return new MemorySimulationRunMetricsRepository();
  }

  insertRow = async (row: SimulationRunMetricsProjectionRecord): Promise<void> => {
    this.rows.push(row);
  };

  insertRows = async (rows: SimulationRunMetricsProjectionRecord[]): Promise<void> => {
    this.rows.push(...rows);
  };
}
