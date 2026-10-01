import type { FeatureFlagRepositories } from "../feature-flag.repositories.ts";
import { MemoryFeatureFlagExperimentRepository } from "./memory.feature-flag-experiment-setting.repository.ts";
import { MemoryFeatureFlagRepository } from "./memory.feature-flag.repository.ts";

export class MemoryFeatureFlagRepositories {
  static readonly requires = [] as const;

  static create(): FeatureFlagRepositories {
    return {
      flags: MemoryFeatureFlagRepository.create(),
      experiments: MemoryFeatureFlagExperimentRepository.create(),
    };
  }
}
