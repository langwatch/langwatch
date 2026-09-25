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
 * The deployment asked for the studio's Lambda sweep and composed no fleet
 * for it to run against. Named rather than an empty report: "nothing was
 * quiet" and "nothing was looked at" read alike, and only one is healthy.
 */
export class NlpLambdaFleetNotComposedError extends Error {
  readonly code = "nlp_lambda_fleet_not_composed" as const;

  constructor() {
    super("This deployment composed no NLP Lambda fleet, so there is nothing to sweep.");
    this.name = "NlpLambdaFleetNotComposedError";
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
