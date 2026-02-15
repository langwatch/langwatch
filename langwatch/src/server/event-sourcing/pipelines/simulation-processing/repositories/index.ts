export { SimulationRunStateRepositoryClickHouse } from "./simulationRunState.clickhouse.repository";
export { SimulationRunStateRepositoryMemory } from "./simulationRunState.memory.repository";
export type { SimulationRunStateRepository } from "./simulationRunState.repository";

import { getClickHouseClient } from "~/server/clickhouse/client";
import { SimulationRunStateRepositoryClickHouse } from "./simulationRunState.clickhouse.repository";
import { SimulationRunStateRepositoryMemory } from "./simulationRunState.memory.repository";
import type { SimulationRunStateRepository } from "./simulationRunState.repository";

let _simulationRunStateRepository: SimulationRunStateRepository | null = null;

/**
 * Gets the simulation run state repository, initializing it lazily on first call.
 */
export function getSimulationRunStateRepository(): SimulationRunStateRepository {
  if (_simulationRunStateRepository === null) {
    const clickHouseClient = getClickHouseClient();
    _simulationRunStateRepository = clickHouseClient
      ? new SimulationRunStateRepositoryClickHouse(clickHouseClient)
      : new SimulationRunStateRepositoryMemory();
  }
  return _simulationRunStateRepository;
}
