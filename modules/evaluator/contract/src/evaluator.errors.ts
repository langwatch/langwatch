import { HandledError, NotFoundError } from "@langwatch/handled-error";

export class EvaluatorNotFoundError extends NotFoundError {
  declare readonly code: "evaluator_not_found";
  constructor(id: string) {
    super("evaluator_not_found", "Evaluator", id);
    this.name = "EvaluatorNotFoundError";
  }
}

export class EvaluatorInvalidTypeError extends HandledError {
  declare readonly code: "evaluator_invalid_type";
  constructor(type: string) {
    super("evaluator_invalid_type", `Unsupported evaluator type: ${type}`, {
      httpStatus: 400,
      meta: { type },
      fault: "customer",
    });
    this.name = "EvaluatorInvalidTypeError";
  }
}

export class EvaluatorWorkflowAlreadyAssignedError extends HandledError {
  declare readonly code: "evaluator_workflow_already_assigned";
  constructor(workflowId: string) {
    super(
      "evaluator_workflow_already_assigned",
      "An evaluator is already assigned to this workflow.",
      {
        httpStatus: 409,
        meta: { workflowId },
        fault: "customer",
      },
    );
    this.name = "EvaluatorWorkflowAlreadyAssignedError";
  }
}

export class EvaluatorIsNotCopyError extends HandledError {
  declare readonly code: "evaluator_is_not_copy";
  constructor(evaluatorId: string) {
    super("evaluator_is_not_copy", "This evaluator is not a copy.", {
      httpStatus: 409,
      meta: { evaluatorId },
      fault: "customer",
    });
    this.name = "EvaluatorIsNotCopyError";
  }
}

export class EvaluatorSourceNotFoundError extends NotFoundError {
  declare readonly code: "evaluator_source_not_found";
  constructor(sourceEvaluatorId: string) {
    super("evaluator_source_not_found", "Source evaluator", sourceEvaluatorId);
    this.name = "EvaluatorSourceNotFoundError";
  }
}

export class EvaluatorCopySelectionError extends HandledError {
  declare readonly code: "evaluator_copy_selection_invalid";
  constructor(evaluatorId: string) {
    super("evaluator_copy_selection_invalid", "No valid evaluator copies were selected.", {
      httpStatus: 400,
      meta: { evaluatorId },
      fault: "customer",
    });
    this.name = "EvaluatorCopySelectionError";
  }
}

export class EvaluatorWorkflowNotFoundError extends HandledError {
  declare readonly code: "evaluator_workflow_not_found";

  constructor(idOrSlug: string, workflowId: string) {
    super("evaluator_workflow_not_found", `Workflow not found for evaluator: ${idOrSlug}`, {
      httpStatus: 404,
      meta: { idOrSlug, workflowId },
      fault: "customer",
    });
    this.name = "EvaluatorWorkflowNotFoundError";
  }
}

export class EvaluatorInvalidConfigError extends HandledError {
  declare readonly code: "evaluator_config_invalid";

  constructor(idOrSlug: string) {
    super("evaluator_config_invalid", `Code evaluator has an invalid config: ${idOrSlug}`, {
      httpStatus: 400,
      meta: { idOrSlug },
      fault: "customer",
    });
    this.name = "EvaluatorInvalidConfigError";
  }
}

/**
 * A workflow evaluator was asked to replicate before its workflow was ever
 * saved. The copy would be a structurally broken replica, so the refusal is
 * the caller's to act on: save a version first.
 */
export class EvaluatorWorkflowVersionRequiredError extends HandledError {
  declare readonly code: "evaluator_workflow_version_required";

  constructor(evaluatorId: string) {
    super("evaluator_workflow_version_required", "This evaluator's workflow has no saved version", {
      httpStatus: 400,
      fault: "customer",
      meta: { evaluatorId },
    });
    this.name = "EvaluatorWorkflowVersionRequiredError";
  }
}

/**
 * The wizard asked to attach a second evaluator to a workflow that already has
 * one. 400 rather than the 409 `EvaluatorWorkflowAlreadyAssignedError` answers,
 * because this is the status the `evaluators.create` door has answered since it
 * shipped and a client branches on it.
 */
export class EvaluatorWorkflowEvaluatorExistsError extends HandledError {
  declare readonly code: "evaluator_workflow_evaluator_exists";

  constructor(input: { workflowId: string; evaluatorName: string }) {
    super(
      "evaluator_workflow_evaluator_exists",
      `An evaluator already exists for this workflow: "${input.evaluatorName}"`,
      { httpStatus: 400, fault: "customer", meta: { workflowId: input.workflowId } },
    );
    this.name = "EvaluatorWorkflowEvaluatorExistsError";
  }
}

/**
 * An update tried to change what the evaluator IS. The type is fixed at
 * creation: changing it would make every result already stored under it mean
 * something else.
 */
export class EvaluatorTypeImmutableError extends HandledError {
  declare readonly code: "evaluator_type_immutable";

  constructor(currentType: string) {
    super(
      "evaluator_type_immutable",
      `evaluatorType cannot be changed after creation. Current type: "${currentType}"`,
      { httpStatus: 400, fault: "customer", meta: { currentType } },
    );
    this.name = "EvaluatorTypeImmutableError";
  }
}

/**
 * Replicating reads the source project, and the caller may not manage it. 401
 * rather than 403, which is the status this refusal has answered since it
 * shipped; `AgentSourcePermissionDeniedError` keeps the same one for the same
 * reason.
 */
export class EvaluatorSourcePermissionDeniedError extends HandledError {
  declare readonly code: "evaluator_source_permission_denied";

  constructor(sourceProjectId: string) {
    super(
      "evaluator_source_permission_denied",
      "You do not have permission to manage evaluations in the source project",
      { httpStatus: 401, fault: "customer", meta: { sourceProjectId } },
    );
    this.name = "EvaluatorSourcePermissionDeniedError";
  }
}
