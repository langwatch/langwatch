/**
 * Errors for the Experiments API
 */

/**
 * Base error for experiment-related issues
 */
export class ExperimentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExperimentError";
  }
}

/**
 * Thrown when initialization fails
 */
export class ExperimentInitError extends ExperimentError {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = "ExperimentInitError";
  }
}

/**
 * Thrown when API calls fail
 */
export class ExperimentApiError extends ExperimentError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "ExperimentApiError";
  }
}

/**
 * Thrown when target metadata conflicts
 */
export class TargetMetadataConflictError extends ExperimentError {
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
 * Thrown when a comparison cannot produce a verdict the caller asked for
 *
 * A row that is simply too thin to judge is skipped instead, so this is
 * reserved for a mismatch between what the caller named and what the run
 * actually recorded.
 */
export class ComparisonError extends ExperimentError {
  constructor(
    message: string,
    public readonly missingTargets: string[] = []
  ) {
    super(message);
    this.name = "ComparisonError";
  }
}

/**
 * Thrown when an evaluator call fails
 */
export class EvaluatorError extends ExperimentError {
  constructor(
    public readonly evaluatorSlug: string,
    message: string,
    public readonly cause?: Error
  ) {
    super(`Evaluator '${evaluatorSlug}' failed: ${message}`);
    this.name = "EvaluatorError";
  }
}
