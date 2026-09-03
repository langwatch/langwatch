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
