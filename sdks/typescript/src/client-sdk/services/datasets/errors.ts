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

/**
 * Thrown for client-side validation failures (e.g. empty name, no update fields, empty entries).
 * Distinguished from DatasetApiError which represents server-side errors.
 */
export class DatasetValidationError extends DatasetError {
  /** Stable code for refusals a caller may branch on; the message may change. */
  readonly code?: DatasetValidationCode;

  constructor(message: string, code?: DatasetValidationCode) {
    super(message);
    this.name = "DatasetValidationError";
    this.code = code;
  }
}

/** Codes an upsert refusal carries. */
export type DatasetValidationCode =
  | "missing_upsert_key"
  | "duplicate_upsert_key"
  | "dataset_has_duplicate_key";

/**
 * Thrown when a dataset operation exceeds the plan limit (403).
 * The message includes the upgrade/subscription URL from the server.
 */
export class DatasetPlanLimitError extends DatasetError {
  readonly limitType: string;
  readonly current?: number;
  readonly max?: number;

  constructor(message: string, originalError?: unknown) {
    super(message);
    this.name = "DatasetPlanLimitError";

    if (originalError != null && typeof originalError === "object") {
      const err = originalError as Record<string, unknown>;
      this.limitType = typeof err.limitType === "string" ? err.limitType : "datasets";
      this.current = typeof err.current === "number" ? err.current : undefined;
      this.max = typeof err.max === "number" ? err.max : undefined;
    } else {
      this.limitType = "datasets";
    }
  }
}
