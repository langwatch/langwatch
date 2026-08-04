/**
 * Error classes for the Evaluations API
 */

/**
 * Base error for evaluation operations
 */
export class EvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationError";
  }
}

/**
 * Error when an evaluator call fails
 */
export class EvaluatorCallError extends EvaluationError {
  readonly evaluatorSlug: string;
  readonly statusCode?: number;

  constructor(evaluatorSlug: string, message: string, statusCode?: number) {
    super(`Evaluator '${evaluatorSlug}' failed: ${message}`);
    this.name = "EvaluatorCallError";
    this.evaluatorSlug = evaluatorSlug;
    this.statusCode = statusCode;
  }
}

/**
 * Error when evaluator is not found
 */
export class EvaluatorNotFoundError extends EvaluationError {
  readonly evaluatorSlug: string;

  constructor(evaluatorSlug: string) {
    super(`Evaluator not found: ${evaluatorSlug}`);
    this.name = "EvaluatorNotFoundError";
    this.evaluatorSlug = evaluatorSlug;
  }
}

/**
 * Error from the evaluations API
 */
export class EvaluationsApiError extends EvaluationError {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "EvaluationsApiError";
    this.statusCode = statusCode;
  }
}
