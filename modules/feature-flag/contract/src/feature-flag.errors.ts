import { HandledError } from "@langwatch/handled-error";

/**
 * A key that resolves to no registered definition and no family. Callers are
 * type-checked against `FeatureFlagKey`, so reaching this means the registry
 * and the caller have genuinely diverged.
 */
export class UnknownFeatureFlagError extends HandledError {
  declare readonly code: "feature_flag_unknown";

  constructor(flagKey: string) {
    super("feature_flag_unknown", "That feature flag is not registered.", {
      httpStatus: 400,
      meta: { flagKey },
    });
    this.name = "UnknownFeatureFlagError";
  }
}

export class UnknownFeatureFlagExperimentError extends HandledError {
  declare readonly code: "feature_flag_experiment_unknown";

  constructor() {
    super("feature_flag_experiment_unknown", "That experiment does not exist.", {
      httpStatus: 404,
    });
    this.name = "UnknownFeatureFlagExperimentError";
  }
}

/**
 * Raised when someone tries to join an experiment that is not open to them —
 * not released, not in their rollout, or switched off by an operator. The
 * caller can act on it: stop offering the experiment.
 */
export class FeatureFlagExperimentUnavailableError extends HandledError {
  declare readonly code: "feature_flag_experiment_unavailable";

  constructor() {
    super("feature_flag_experiment_unavailable", "That experiment is not available to you.", {
      httpStatus: 403,
    });
    this.name = "FeatureFlagExperimentUnavailableError";
  }
}
