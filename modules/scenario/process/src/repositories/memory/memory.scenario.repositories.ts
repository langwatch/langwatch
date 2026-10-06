import type { ScenarioRepositories } from "../scenario.repositories.ts";
import { MemoryResultAtomsRepository } from "./memory.result-atoms.repository.ts";
import { MemoryRunConfigurationsRepository } from "./memory.run-configurations.repository.ts";
import { MemoryScenarioCancellationRepository } from "./memory.scenario-cancellation.repository.ts";
import { MemoryScenarioRateLimitRepository } from "./memory.scenario-rate-limit.repository.ts";
import { MemoryScenarioTabStoreRepository } from "./memory.scenario-tab-store.repository.ts";
import { MemoryScenarioRepository } from "./memory.scenario.repository.ts";
import { MemorySimulationRunProcessingRepository } from "./memory.simulation-run-processing.repository.ts";
import { MemorySimulationRepository } from "./memory.simulation.repository.ts";
import { MemoryStalledSimulationRunRepository } from "./memory.stalled-simulation-run.repository.ts";
import { MemoryVoiceNonceRepository } from "./memory.voice-nonce.repository.ts";

/** The Scenario aggregate and its run stores with no datastore behind them. */
export class MemoryScenarioRepositories {
  static readonly requires = [] as const;

  static create(): ScenarioRepositories {
    return {
      scenarios: MemoryScenarioRepository.create(),
      simulationRunProcessing: MemorySimulationRunProcessingRepository.create(),
      stalledRuns: MemoryStalledSimulationRunRepository.create(),
      tabs: MemoryScenarioTabStoreRepository.create(),
      resultAtoms: MemoryResultAtomsRepository.create(),
      runConfigurations: MemoryRunConfigurationsRepository.create(),
      voiceNonces: MemoryVoiceNonceRepository.create(),
      simulations: MemorySimulationRepository.create(),
      rateLimits: MemoryScenarioRateLimitRepository.create(),
      cancellations: MemoryScenarioCancellationRepository.create(),
    };
  }
}
