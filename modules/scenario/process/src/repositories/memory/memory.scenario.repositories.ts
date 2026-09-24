import type { ScenarioRepositories } from "../scenario.repositories.ts";
import { MemoryCancellationChannelRepository } from "./memory.cancellation-channel.repository.ts";
import { MemoryScenarioRepository } from "./memory.scenario.repository.ts";
import { MemorySimulationRunProcessingRepository } from "./memory.simulation-run-processing.repository.ts";

/** The Scenario aggregate and its run stores with no datastore behind them. */
export class MemoryScenarioRepositories {
  static readonly requires = [] as const;

  static create(): ScenarioRepositories {
    return {
      scenarios: MemoryScenarioRepository.create(),
      simulationRunProcessing: MemorySimulationRunProcessingRepository.create(),
      cancellations: MemoryCancellationChannelRepository.create(),
    };
  }
}
