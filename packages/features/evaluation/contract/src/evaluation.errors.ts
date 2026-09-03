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
