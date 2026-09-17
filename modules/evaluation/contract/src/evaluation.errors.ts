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
