/**
 * Error classes for platform evaluations API (Evaluations V3)
 */

/**
 * Base error for evaluation operations
 */
export class EvaluationsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationsError";
  }
}

/**
 * Error when evaluation is not found
 */
export class EvaluationNotFoundError extends EvaluationsError {
  constructor(slug: string) {
    super(`Evaluation not found: ${slug}`);
    this.name = "EvaluationNotFoundError";
  }
}

/**
 * Error when evaluation run times out
 */
export class EvaluationTimeoutError extends EvaluationsError {
  readonly runId: string;
  readonly progress: number;
  readonly total: number;

  constructor(runId: string, progress: number, total: number) {
    super(`Evaluation run timed out: ${runId} (${progress}/${total} completed)`);
    this.name = "EvaluationTimeoutError";
    this.runId = runId;
    this.progress = progress;
    this.total = total;
  }
}

/**
 * Error when evaluation run fails
 */
export class EvaluationRunFailedError extends EvaluationsError {
  readonly runId: string;
  readonly errorMessage: string;

  constructor(runId: string, errorMessage: string) {
    super(`Evaluation run failed: ${errorMessage}`);
    this.name = "EvaluationRunFailedError";
    this.runId = runId;
    this.errorMessage = errorMessage;
  }
}

/**
 * Error from the evaluations API
 */
export class EvaluationsApiError extends EvaluationsError {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "EvaluationsApiError";
    this.statusCode = statusCode;
  }
}
