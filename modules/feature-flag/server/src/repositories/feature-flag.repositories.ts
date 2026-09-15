import type { FeatureFlagExperimentRepository } from "./feature-flag-experiment-setting.repository.ts";
import type { FeatureFlagRepository } from "./feature-flag.repository.ts";

/**
 * The two stores the feature owns: the operator rows every process resolves
 * flags from, and the experiment settings a person or an owner writes.
 */
export interface FeatureFlagRepositories {
  readonly flags: FeatureFlagRepository;
  readonly experiments: FeatureFlagExperimentRepository;
}
