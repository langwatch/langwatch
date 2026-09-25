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

export class ExperimentWorkbenchUnauthorizedError extends HandledError {
  declare readonly code: "unauthorized";

  constructor() {
    super("unauthorized", "You must be logged in to access this endpoint.", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "ExperimentWorkbenchUnauthorizedError";
  }
}

export class ExperimentWorkbenchForbiddenError extends HandledError {
  declare readonly code: "forbidden";

  constructor() {
    super("forbidden", "You do not have permission to access this endpoint.", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "ExperimentWorkbenchForbiddenError";
  }
}

export class ExperimentRunLoopUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ExperimentRunLoopUnavailableError";
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

/** The workflow an experiment writes its versions into is gone, or it never had one. */
export class ExperimentWorkflowNotFoundError extends NotFoundError {
  declare readonly code: "experiment_workflow_not_found";

  constructor(experimentId: string) {
    super("experiment_workflow_not_found", "Experiment workflow", experimentId, {
      meta: { experimentId },
    });
    this.name = "ExperimentWorkflowNotFoundError";
  }
}

/** The wizard has no stored setup, graph or evaluator yet, so there is no monitor to publish. */
export class ExperimentNotReadyForMonitorError extends HandledError {
  declare readonly code: "experiment_not_ready_for_monitor";

  constructor(experimentId: string) {
    super("experiment_not_ready_for_monitor", "Experiment is not ready to be saved as a monitor", {
      httpStatus: 400,
      fault: "customer",
      meta: { experimentId },
    });
    this.name = "ExperimentNotReadyForMonitorError";
  }
}

/** A lookup that named neither the experiment's id nor its slug. */
export class ExperimentIdOrSlugRequiredError extends HandledError {
  declare readonly code: "validation_error";

  constructor() {
    super("validation_error", "Either experimentId or experimentSlug must be provided", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "ExperimentIdOrSlugRequiredError";
  }
}

/** The caller may not manage evaluations in a second project the declared check never covered. */
export class ExperimentPermissionDeniedError extends HandledError {
  declare readonly code: "permission_denied";

  constructor({ permission, message }: { permission: string; message: string }) {
    super("permission_denied", message, {
      httpStatus: 401,
      fault: "customer",
      meta: { permission },
    });
    this.name = "ExperimentPermissionDeniedError";
  }
}

const EVALUATION_INPUT_REFUSALS = {
  400: { code: "experiment_evaluation_input_invalid" },
  404: { code: "experiment_evaluation_reference_not_found" },
  422: { code: "experiment_evaluation_too_many_rows" },
} as const;

type EvaluationInputStatus = keyof typeof EVALUATION_INPUT_REFUSALS;

/** A workflow evaluation's rows, dataset or targets could not be loaded as sent. */
export class ExperimentEvaluationInputError extends HandledError {
  declare readonly code: (typeof EVALUATION_INPUT_REFUSALS)[EvaluationInputStatus]["code"];

  constructor({ status, reason }: { status: number; reason: string }) {
    const httpStatus: EvaluationInputStatus = status === 404 || status === 422 ? status : 400;
    super(EVALUATION_INPUT_REFUSALS[httpStatus].code, reason, {
      httpStatus,
      fault: "customer",
    });
    this.name = "ExperimentEvaluationInputError";
  }
}
