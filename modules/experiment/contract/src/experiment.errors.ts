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

export class ExperimentTypeMismatchError extends HandledError {
  declare readonly code: "experiment_type_mismatch";

  constructor() {
    super("experiment_type_mismatch", "This experiment is not an evaluation workbench", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "ExperimentTypeMismatchError";
  }
}

export class StaleWorkbenchStateError extends HandledError {
  declare readonly code: "experiment_stale_workbench_state";

  constructor({
    currentVersion,
    actorLabel,
    runId,
  }: {
    currentVersion: number;
    actorLabel?: string;
    runId?: string;
  }) {
    super("experiment_stale_workbench_state", "This evaluation changed since you loaded it", {
      httpStatus: 409,
      fault: "customer",
      meta: {
        currentVersion,
        ...(actorLabel !== undefined ? { actorLabel } : {}),
        ...(runId !== undefined ? { runId } : {}),
      },
    });
    this.name = "StaleWorkbenchStateError";
  }
}

export class WorkbenchMissingReferenceError extends HandledError {
  declare readonly code: "experiment_workbench_missing_reference";

  constructor({ refType, refId }: { refType: string; refId: string }) {
    super(
      "experiment_workbench_missing_reference",
      "This evaluation points at something that no longer exists",
      { httpStatus: 400, fault: "customer", meta: { refType, refId } },
    );
    this.name = "WorkbenchMissingReferenceError";
  }
}

export class InvalidWorkbenchStateError extends HandledError {
  declare readonly code: "experiment_invalid_workbench_state";

  constructor({ issues }: { issues: readonly { path: string; message: string }[] }) {
    super("experiment_invalid_workbench_state", "This evaluation's setup could not be saved", {
      httpStatus: 400,
      fault: "customer",
      meta: { issues },
    });
    this.name = "InvalidWorkbenchStateError";
  }
}

export class ExperimentVersionNotFoundError extends NotFoundError {
  declare readonly code: "experiment_version_not_found";

  constructor({ experimentId, version }: { experimentId: string; version: number }) {
    super("experiment_version_not_found", "Experiment version", String(version), {
      meta: { experimentId, version },
    });
    this.name = "ExperimentVersionNotFoundError";
  }
}
