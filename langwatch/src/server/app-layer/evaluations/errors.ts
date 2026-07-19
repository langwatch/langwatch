import {
  HandledError,
  type HandledErrorOptions,
  NotFoundError,
} from "@langwatch/handled-error";

import { remediation } from "../error-remediation";

export class EvaluationNotFoundError extends NotFoundError {
  declare readonly code: "evaluation_not_found";

  constructor(
    evaluationId: string,
    options: { reasons?: readonly Error[] } = {},
  ) {
    super("evaluation_not_found", "Evaluation", evaluationId, {
      meta: { evaluationId },
      ...remediation("evaluation_not_found"),
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
      ...remediation("trace_not_evaluatable"),
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
      ...remediation("evaluator_config_error"),
      ...options,
    });
    this.name = "EvaluatorConfigError";
  }
}

/**
 * The payload sent to the evaluator exceeded its size limit (HTTP 413).
 *
 * Distinct from {@link EvaluatorExecutionError} because the fault is the
 * customer's, not ours: nothing is broken on our side, and retrying sends the
 * same oversized body again. Splitting it out means it reports as a skip with
 * an actionable message rather than an opaque `413 {"message":"Request Too
 * Long"}` error the customer cannot act on.
 */
export class EvaluatorInputTooLargeError extends HandledError {
  declare readonly code: "evaluator_input_too_large";

  constructor(options: HandledErrorOptions = {}) {
    super(
      "evaluator_input_too_large",
      "Evaluator input is too large — shorten the text sent to this evaluator",
      {
        httpStatus: 413,
        fault: "customer",
        ...remediation("evaluator_input_too_large"),
        ...options,
      },
    );
    this.name = "EvaluatorInputTooLargeError";
  }
}

export class EvaluatorExecutionError extends HandledError {
  declare readonly code: "evaluator_execution_error";

  constructor(message: string, options: HandledErrorOptions = {}) {
    super("evaluator_execution_error", message, {
      httpStatus: 502,
      // The evaluator backend failed to run — an execution failure on our
      // side, not caller error.
      fault: "platform",
      ...remediation("evaluator_execution_error"),
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
        ...remediation("evaluator_missing_field"),
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
      ...remediation("evaluator_not_found"),
      ...options,
    });
    this.name = "EvaluatorNotFoundError";
  }
}
