import type { FoldProjectionStore } from "@langwatch/eventing";

import { SimulationRunMetricsAppendStore } from "../../eventing/simulation-run-metrics.store.ts";
import type { SimulationRunStateData } from "../../eventing/simulation-run-state.projection.ts";
import { SimulationRunStateStoreAdapter } from "../clickhouse/clickhouse.simulation-eventing.repository.ts";
import type { SimulationRunProcessingRepository } from "../simulation-run-processing.repository.ts";
import { MemorySimulationRunMetricsRepository } from "./memory.simulation-run-metrics.repository.ts";

/** The run fold and metrics rows in memory; no cache tier, the durable store is already one. */
export class MemorySimulationRunProcessingRepository implements SimulationRunProcessingRepository {
  readonly metrics = MemorySimulationRunMetricsRepository.create();
  readonly #runs = SimulationRunStateStoreAdapter.create({ type: "memory" });

  private constructor() {}

  static create(): MemorySimulationRunProcessingRepository {
    return new MemorySimulationRunProcessingRepository();
  }

  runStateStore(): FoldProjectionStore<SimulationRunStateData> {
    return this.#runs.createFoldStore();
  }

  runMetricsStore(): SimulationRunMetricsAppendStore {
    return SimulationRunMetricsAppendStore.create(this.metrics);
  }
}
