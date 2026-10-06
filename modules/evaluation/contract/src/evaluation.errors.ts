import { HandledError } from "@langwatch/handled-error";

export class EvaluationRestExperimentNotFoundError extends HandledError {
  declare readonly code: "not_found";

  constructor(slug: string) {
    super("not_found", "Experiment not found", {
      httpStatus: 404,
      meta: { experimentSlug: slug },
    });
    this.name = "EvaluationRestExperimentNotFoundError";
  }
}

export class EvaluationNotFoundError extends Error {
  readonly code = "evaluation_not_found" as const;
  constructor(readonly evaluationId: string) {
    super(`Evaluation ${evaluationId} not found.`);
    this.name = "EvaluationNotFoundError";
  }
}

export class EvaluationTraceNotEvaluatableError extends Error {
  readonly code = "evaluation_trace_not_evaluatable" as const;
  constructor(readonly traceId: string) {
    super(`Trace ${traceId} cannot be evaluated.`);
    this.name = "EvaluationTraceNotEvaluatableError";
  }
}

/** One SDK batch of results is larger than the organization accepts in one request. */
export class EvaluationLogResultsTooLargeError extends HandledError {
  declare readonly code: "evaluation_log_results_too_large";

  constructor({ maxBytes }: { maxBytes: number }) {
    super(
      "evaluation_log_results_too_large",
      `The batch of results is larger than the ${Math.floor(maxBytes / (1024 * 1024))} MB one request carries. ` +
        "Send fewer results per request, and send images as links or dataset attachments instead of inline data.",
      { httpStatus: 413, fault: "customer", meta: { maxBytes } },
    );
    this.name = "EvaluationLogResultsTooLargeError";
  }
}
