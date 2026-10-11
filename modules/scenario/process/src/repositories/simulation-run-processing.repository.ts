import type { IdIndexFlags } from "@langwatch/clickhouse-client";
import type { AppendStore, FoldProjectionStore } from "@langwatch/eventing";

import type { SimulationRunMetricsProjectionRecord } from "../eventing/simulation-run-metrics.projection.ts";
import type { SimulationRunStateData } from "../eventing/simulation-run-state.projection.ts";

/** The run-state fold and the metrics append that simulation_processing projects into. */
export interface SimulationRunProcessingRepository {
  runStateStore(input: {
    defaultRetentionDays: () => number;
    /** Whether this module's id indexes are filled; absent reads the run with no time bound. */
    idIndex?: IdIndexFlags | undefined;
  }): FoldProjectionStore<SimulationRunStateData>;
  runMetricsStore(): AppendStore<SimulationRunMetricsProjectionRecord>;
}
