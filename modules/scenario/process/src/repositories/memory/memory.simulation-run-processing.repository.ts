import type { FoldProjectionStore } from "@langwatch/eventing";

import { SimulationRunStateStore } from "../../eventing/simulation-eventing.store.ts";
import type { SimulationRunMetricsProjectionRecord } from "../../eventing/simulation-run-metrics.projection.ts";
import { SimulationRunMetricsAppendStore } from "../../eventing/simulation-run-metrics.store.ts";
import type {
  SimulationRunState,
  SimulationRunStateData,
} from "../../eventing/simulation-run-state.projection.ts";
import { SimulationRunMetricsRepository } from "../simulation-run-metrics.repository.ts";
import type { SimulationRunProcessingRepository } from "../simulation-run-processing.repository.ts";
import { MemorySimulationRunStateRepository } from "./memory.simulation-run-state.repository.ts";

/** The metrics rows the run fold appends, kept in arrival order. */
class MemorySimulationRunMetricsRepository extends SimulationRunMetricsRepository {
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

/**
 * The run fold and metrics rows in memory; no cache tier, the durable store is already one.
 * `runs` is the fold itself, which the memory read twins answer from.
 */
export class MemorySimulationRunProcessingRepository implements SimulationRunProcessingRepository {
  readonly metrics = MemorySimulationRunMetricsRepository.create();
  readonly runs = MemorySimulationRunStateRepository.create<SimulationRunState>();
  readonly #store = SimulationRunStateStore.create({ type: "memory", runs: this.runs });

  private constructor() {}

  static create(): MemorySimulationRunProcessingRepository {
    return new MemorySimulationRunProcessingRepository();
  }

  runStateStore(): FoldProjectionStore<SimulationRunStateData> {
    return this.#store.createFoldStore();
  }

  runMetricsStore(): SimulationRunMetricsAppendStore {
    return SimulationRunMetricsAppendStore.create(this.metrics);
  }
}
