import type { AppendStore, FoldProjectionStore } from "@langwatch/eventing";

import type { SimulationRunMetricsProjectionRecord } from "../eventing/simulation-run-metrics.projection.ts";
import type { SimulationRunStateData } from "../eventing/simulation-run-state.projection.ts";

/** The run-state fold and the metrics append that simulation_processing projects into. */
export interface SimulationRunProcessingRepository {
  runStateStore(input: {
    defaultRetentionDays: () => number;
  }): FoldProjectionStore<SimulationRunStateData>;
  runMetricsStore(): AppendStore<SimulationRunMetricsProjectionRecord>;
}
