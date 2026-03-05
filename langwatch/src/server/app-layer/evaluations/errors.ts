import { DomainError, NotFoundError } from "../domain-error";

export class EvaluationNotFoundError extends NotFoundError {
  declare readonly kind: "evaluation_not_found";

  constructor(
    evaluationId: string,
    options: { reasons?: readonly Error[] } = {},
  ) {
    super("evaluation_not_found", "Evaluation", evaluationId, {
      meta: { evaluationId },
      ...options,
    });
    this.name = "EvaluationNotFoundError";
  }
}

export class TraceNotEvaluatableError extends DomainError {
  declare readonly kind: "trace_not_evaluatable";

  constructor(
    traceId: string,
    options: { reasons?: readonly Error[] } = {},
  ) {
    super("trace_not_evaluatable", `Trace ${traceId} is not evaluatable`, {
      meta: { traceId },
      httpStatus: 422,
      ...options,
    });
    this.name = "TraceNotEvaluatableError";
  }
}

export class EvaluatorConfigError extends DomainError {
  declare readonly kind: "evaluator_config_error";

  constructor(
    message: string,
    options: { meta?: Record<string, unknown>; reasons?: readonly Error[] } = {},
  ) {
    super("evaluator_config_error", message, {
      httpStatus: 422,
      ...options,
    });
    this.name = "EvaluatorConfigError";
  }
}

export class CostLimitExceededError extends DomainError {
  declare readonly kind: "cost_limit_exceeded";

  constructor(
    organizationId: string,
    options: { reasons?: readonly Error[] } = {},
  ) {
    super("cost_limit_exceeded", "Monthly usage limit exceeded", {
      meta: { organizationId },
      httpStatus: 429,
      ...options,
    });
    this.name = "CostLimitExceededError";
  }
}

export class EvaluatorExecutionError extends DomainError {
  declare readonly kind: "evaluator_execution_error";

  constructor(
    message: string,
    options: { meta?: Record<string, unknown>; reasons?: readonly Error[] } = {},
  ) {
    super("evaluator_execution_error", message, {
      httpStatus: 502,
      ...options,
    });
    this.name = "EvaluatorExecutionError";
  }
}

export class EvaluatorNotFoundError extends NotFoundError {
  declare readonly kind: "evaluator_not_found";

  constructor(
    evaluatorType: string,
    options: { reasons?: readonly Error[] } = {},
  ) {
    super("evaluator_not_found", "Evaluator", evaluatorType, {
      meta: { evaluatorType },
      ...options,
    });
    this.name = "EvaluatorNotFoundError";
  }
}
