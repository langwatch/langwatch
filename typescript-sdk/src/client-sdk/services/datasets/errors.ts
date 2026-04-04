/**
 * Errors for the Dataset API
 */

/**
 * Base error for all dataset operations.
 */
export class DatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetError";
  }
}

/**
 * Thrown when a dataset is not found (404).
 */
export class DatasetNotFoundError extends DatasetError {
  constructor(slugOrId: string) {
    super(`Dataset not found: ${slugOrId}`);
    this.name = "DatasetNotFoundError";
  }
}

/**
 * Error from the Dataset API with operation context.
 * Aligns with PromptsApiError pattern: includes operation and originalError fields.
 */
export class DatasetApiError extends DatasetError {
  readonly status: number;
  readonly operation: string;
  readonly originalError?: unknown;

  constructor(message: string, status: number, operation: string, originalError?: unknown) {
    super(message);
    this.name = "DatasetApiError";
    this.status = status;
    this.operation = operation;
    this.originalError = originalError;
  }
}
