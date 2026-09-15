export class WorkflowNotFoundError extends Error {
  readonly code = "workflow_not_found" as const;
  constructor(
    readonly workflowId: string,
    readonly projectId?: string,
  ) {
    super(`Workflow ${workflowId} not found.`);
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

export class WorkflowVersionRequiredError extends Error {
  readonly code = "workflow_version_required" as const;
  constructor() {
    super("This workflow has no committed version.");
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
export class LlmModelNotSetError extends Error {
  readonly cause = "LLM_MODEL_NOT_SET" as const;

  constructor(nodeName?: string) {
    super(
      `LLM node ${
        nodeName ? `"${nodeName}" ` : ""
      }has no model selected. Open the node and choose a model.`,
    );
    this.name = "LlmModelNotSetError";
  }
}
import { HandledError } from "@langwatch/handled-error";

/**
 * The deployment asked for the studio's Lambda sweep and composed no fleet for
 * it to run against. Named rather than answered as an empty report: "nothing
 * was quiet" and "nothing was looked at" read identically to a scheduler, and
 * only one of them is a healthy deployment.
 */
export class NlpLambdaFleetNotComposedError extends Error {
  readonly code = "nlp_lambda_fleet_not_composed" as const;

  constructor() {
    super("This deployment composed no NLP Lambda fleet, so there is nothing to sweep.");
    this.name = "NlpLambdaFleetNotComposedError";
  }
}
