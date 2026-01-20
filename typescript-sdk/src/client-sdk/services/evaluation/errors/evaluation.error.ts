/**
 * Errors for the Evaluation API
 */

/**
 * Base error for evaluation-related issues
 */
export class EvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationError";
  }
}

/**
 * Thrown when initialization fails
 */
export class EvaluationInitError extends EvaluationError {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = "EvaluationInitError";
  }
}

/**
 * Thrown when API calls fail
 */
export class EvaluationApiError extends EvaluationError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "EvaluationApiError";
  }
}

/**
 * Thrown when target metadata conflicts
 */
export class TargetMetadataConflictError extends EvaluationError {
  constructor(
    public readonly targetName: string,
    public readonly existingMetadata: Record<string, unknown>,
    public readonly newMetadata: Record<string, unknown>
  ) {
    super(
      `Target '${targetName}' was previously registered with different metadata.\n` +
        `Original: ${JSON.stringify(existingMetadata)}\n` +
        `New: ${JSON.stringify(newMetadata)}\n` +
        `If you want to use different metadata, please use a different target name.`
    );
    this.name = "TargetMetadataConflictError";
  }
}

/**
 * Thrown when an evaluator call fails
 */
export class EvaluatorError extends EvaluationError {
  constructor(
    public readonly evaluatorSlug: string,
    message: string,
    public readonly cause?: Error
  ) {
    super(`Evaluator '${evaluatorSlug}' failed: ${message}`);
    this.name = "EvaluatorError";
  }
}
