import type { ScenarioRepositories } from "../scenario.repositories.ts";
import { MemoryScenarioRepository } from "./memory.scenario.repository.ts";

/** The Scenario aggregate with no datastore behind it, for a boot that needs none. */
export class MemoryScenarioRepositories {
  static readonly requires = [] as const;

  static create(): ScenarioRepositories {
    return { scenarios: MemoryScenarioRepository.create() };
  }
}
