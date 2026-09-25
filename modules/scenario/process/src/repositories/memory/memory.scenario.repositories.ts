import type { ScenarioRepositories } from "../scenario.repositories.ts";
import { MemoryCancellationChannelRepository } from "./memory.cancellation-channel.repository.ts";
import { MemoryResultAtomsRepository } from "./memory.result-atoms.repository.ts";
import { MemoryRunConfigurationsRepository } from "./memory.run-configurations.repository.ts";
import { MemoryScenarioTabStoreRepository } from "./memory.scenario-tab-store.repository.ts";
import { MemoryScenarioRepository } from "./memory.scenario.repository.ts";
import { MemorySimulationRunProcessingRepository } from "./memory.simulation-run-processing.repository.ts";
import { MemoryStalledSimulationRunRepository } from "./memory.stalled-simulation-run.repository.ts";

/** The Scenario aggregate and its run stores with no datastore behind them. */
export class MemoryScenarioRepositories {
  static readonly requires = [] as const;

  static create(): ScenarioRepositories {
    const cancellations = MemoryCancellationChannelRepository.create();
    return {
      scenarios: MemoryScenarioRepository.create(),
      simulationRunProcessing: MemorySimulationRunProcessingRepository.create(),
      cancellations,
      cancellationSubscriptions: cancellations,
      stalledRuns: MemoryStalledSimulationRunRepository.create(),
      tabs: MemoryScenarioTabStoreRepository.create(),
      resultAtoms: MemoryResultAtomsRepository.create(),
      runConfigurations: MemoryRunConfigurationsRepository.create(),
    };
  }
}
