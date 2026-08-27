import { HandledError, NotFoundError } from "@langwatch/handled-error";

export class ExperimentNotFoundError extends NotFoundError {
  declare readonly code: "experiment_not_found";

  constructor(id: string, options: { reasons?: readonly Error[] } = {}) {
    super("experiment_not_found", "Experiment", id, {
      meta: { experimentId: id },
      ...options,
    });
    this.name = "ExperimentNotFoundError";
  }
}

export class ExperimentDspyStepNotFoundError extends NotFoundError {
  declare readonly code: "dspy_step_not_found";

  constructor(stepId: string, options: { reasons?: readonly Error[] } = {}) {
    super("dspy_step_not_found", "DSPy step", stepId, {
      meta: { stepId },
      ...options,
    });
    this.name = "ExperimentDspyStepNotFoundError";
  }
}

export class ExperimentRunNotFoundError extends NotFoundError {
  declare readonly code: "run_not_found";

  constructor(runId: string, options: { reasons?: readonly Error[] } = {}) {
    super("run_not_found", "Run", runId, {
      meta: { runId },
      ...options,
    });
    this.name = "ExperimentRunNotFoundError";
  }
}

export class InvalidExperimentConfigurationError extends HandledError {
  declare readonly code: "invalid_experiment_configuration";

  constructor(slug: string) {
    super(
      "invalid_experiment_configuration",
      "This experiment's saved configuration could not be read.",
      { httpStatus: 400, fault: "platform", meta: { slug } },
    );
    this.name = "InvalidExperimentConfigurationError";
  }
}
