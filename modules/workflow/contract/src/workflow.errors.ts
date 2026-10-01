import { HandledError } from "@langwatch/handled-error";

export class WorkflowNotFoundError extends HandledError {
  declare readonly code: "workflow_not_found";
  constructor(
    readonly workflowId: string,
    readonly projectId?: string,
  ) {
    super("workflow_not_found", `Workflow ${workflowId} not found.`, {
      httpStatus: 404,
      fault: "customer",
      meta: {
        workflowId,
        ...(projectId === undefined ? {} : { projectId }),
      },
    });
    this.name = "WorkflowNotFoundError";
  }
}

export class WorkflowVersionNotFoundError extends Error {
  readonly code = "workflow_version_not_found" as const;
  constructor(readonly versionId: string) {
    super(`Workflow version ${versionId} not found.`);
    this.name = "WorkflowVersionNotFoundError";
  }
}

export class WorkflowNotPublishedError extends Error {
  readonly code = "workflow_not_published" as const;
  constructor(readonly workflowId: string) {
    super("Workflow not published.");
    this.name = "WorkflowNotPublishedError";
  }
}

export class WorkflowDslValidationError extends Error {
  readonly code = "workflow_dsl_invalid" as const;
  constructor(readonly issues: readonly unknown[]) {
    super("Workflow definition is invalid.");
    this.name = "WorkflowDslValidationError";
  }
}

export class WorkflowVersionRequiredError extends HandledError {
  declare readonly code: "workflow_version_required";

  constructor() {
    super("workflow_version_required", "This workflow has no committed version.", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "WorkflowVersionRequiredError";
  }
}

/** The execution engine rejected an otherwise valid Workflow dispatch. */
export class WorkflowExecutionFailedError extends HandledError {
  declare readonly code: "workflow_execution_failed";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super("workflow_execution_failed", "The workflow failed to run.", {
      httpStatus: 502,
      fault: "platform",
      ...options,
    });
    this.name = "WorkflowExecutionFailedError";
  }
}

/** A dispatched Studio LLM node must name its model. */
export class LlmModelNotSetError extends HandledError {
  declare readonly code: "llm_model_not_set";
  readonly cause = "LLM_MODEL_NOT_SET" as const;

  constructor(nodeName?: string) {
    const message = `LLM node ${
      nodeName ? `"${nodeName}" ` : ""
    }has no model selected. Open the node and choose a model.`;
    super("llm_model_not_set", message, {
      httpStatus: 422,
      fault: "customer",
    });
    this.name = "LlmModelNotSetError";
  }
}

/**
 * The caller may not act in a project the workflow's copy lineage reaches.
 * 401, not 403: the status this refusal has answered since shipping.
 */
export class WorkflowPermissionDeniedError extends HandledError {
  declare readonly code: "permission_denied";

  constructor({ permission, message }: { permission: string; message: string }) {
    super("permission_denied", message, {
      httpStatus: 401,
      fault: "customer",
      meta: { permission },
    });
    this.name = "WorkflowPermissionDeniedError";
  }
}

/** A Studio door reached with no signed-in caller. */
export class WorkflowCallerUnauthenticatedError extends HandledError {
  declare readonly code: "unauthorized";

  constructor() {
    super("unauthorized", "You must be logged in to access this endpoint.", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "WorkflowCallerUnauthenticatedError";
  }
}

/** A Studio event the server cannot accept: not a valid event document, or an unknown type. */
export class WorkflowStudioEventInvalidError extends HandledError {
  declare readonly code: "validation_error";

  constructor(message = "Invalid body") {
    super("validation_error", message, { httpStatus: 400, fault: "customer" });
    this.name = "WorkflowStudioEventInvalidError";
  }
}

/** Optimization ran on DSPy, which the engine dropped; stop events still pass. */
export class WorkflowOptimizationRemovedError extends HandledError {
  declare readonly code: "workflow_optimization_removed";

  constructor() {
    super(
      "workflow_optimization_removed",
      "Optimization is no longer supported. The Optimize feature relied on DSPy, which has been removed.",
      { httpStatus: 410, fault: "customer" },
    );
    this.name = "WorkflowOptimizationRemovedError";
  }
}

/** The workflow was never copied from anywhere, so there is nothing to sync from. */
export class WorkflowNotACopyError extends HandledError {
  declare readonly code: "workflow_not_a_copy";

  constructor() {
    super("workflow_not_a_copy", "This workflow is not a copy and has no source to sync from", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "WorkflowNotACopyError";
  }
}

export class WorkflowHasNoLatestVersionError extends HandledError {
  declare readonly code: "workflow_has_no_latest_version";

  constructor() {
    super("workflow_has_no_latest_version", "This workflow has no latest version to push", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "WorkflowHasNoLatestVersionError";
  }
}

export class WorkflowHasNoCopiesError extends HandledError {
  declare readonly code: "workflow_has_no_copies";

  constructor() {
    super("workflow_has_no_copies", "This workflow has no copies to push to", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "WorkflowHasNoCopiesError";
  }
}

export class WorkflowNoCopiesSelectedError extends HandledError {
  declare readonly code: "workflow_no_copies_selected";

  constructor() {
    super("workflow_no_copies_selected", "No valid copies selected to push to", {
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "WorkflowNoCopiesSelectedError";
  }
}
