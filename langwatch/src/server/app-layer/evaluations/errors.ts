import { HandledError, NotFoundError } from "../handled-error";

export class EvaluationNotFoundError extends NotFoundError {
  declare readonly code: "evaluation_not_found";

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

export class TraceNotEvaluatableError extends HandledError {
  declare readonly code: "trace_not_evaluatable";

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

export class EvaluatorConfigError extends HandledError {
  declare readonly code: "evaluator_config_error";

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

export class EvaluatorExecutionError extends HandledError {
  declare readonly code: "evaluator_execution_error";

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

/**
 * Thrown when the request data is missing a field the evaluator's definition
 * marks as required (e.g. Pairwise Compare's candidate_a_id/candidate_b_id,
 * which come from Variant A/Variant B not being configured yet). `meta`
 * carries the raw field name so the client can translate it into
 * user-facing language ("Variant A") instead of showing the wire identifier.
 */
export class EvaluatorMissingFieldError extends HandledError {
  declare readonly code: "evaluator_missing_field";

  constructor(
    field: string,
    evaluatorName: string,
    options: { reasons?: readonly Error[] } = {},
  ) {
    super(
      "evaluator_missing_field",
      `${field} is required for ${evaluatorName} evaluator`,
      {
        meta: { field, evaluatorName },
        // Matches the status this replaces (a missing request field is a
        // client Bad Request, not a semantic 422) — existing API consumers
        // of this legacy endpoint keep seeing the same status code.
        httpStatus: 400,
        ...options,
      },
    );
    this.name = "EvaluatorMissingFieldError";
  }
}

export class EvaluatorNotFoundError extends NotFoundError {
  declare readonly code: "evaluator_not_found";

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
