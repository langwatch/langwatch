import type { createLogger } from "~/utils/logger";

/**
 * Error categories for standardized error handling.
 */
export enum ErrorCategory {
  /**
   * Critical errors that must cause operation to fail immediately.
   * Examples: Security violations, data integrity issues, ordering violations.
   */
  CRITICAL = "critical",
  /**
   * Non-critical errors that should be logged but don't fail the operation.
   * Examples: Publishing failures, optional side effects.
   */
  NON_CRITICAL = "non_critical",
  /**
   * Recoverable errors that should trigger retry logic.
   * Examples: Transient network failures, temporary resource unavailability.
   */
  RECOVERABLE = "recoverable",
}

/**
 * Determines if an error is a sequential ordering violation.
 * These are critical errors that must cause the operation to fail.
 */
export function isSequentialOrderingError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.includes(
    "has not been processed yet. Processing stopped to maintain event ordering",
  );
}

/**
 * Extracts the previous sequence number from an ordering error message.
 * Returns null if the error is not an ordering error or if the sequence number cannot be extracted.
 *
 * @param error - The error to extract the sequence number from
 * @returns The previous sequence number, or null if not found
 */
export function extractPreviousSequenceNumber(
  error: unknown,
): number | null {
  if (!isSequentialOrderingError(error)) {
    return null;
  }

  if (!(error instanceof Error)) {
    return null;
  }

  // Error message format: "Previous event (sequence N) has not been processed yet..."
  const match = error.message.match(/sequence (\d+)/);
  if (match && match[1]) {
    const sequenceNumber = parseInt(match[1], 10);
    if (!isNaN(sequenceNumber) && sequenceNumber > 0) {
      return sequenceNumber;
    }
  }

  return null;
}

/**
 * Handles an error according to its category.
 *
 * @param error - The error to handle
 * @param category - The error category
 * @param logger - Optional logger for non-critical errors
 * @param context - Additional context for logging
 * @throws {Error} If category is CRITICAL
 */
export function handleError(
  error: unknown,
  category: ErrorCategory,
  logger?: ReturnType<typeof createLogger>,
  context?: Record<string, unknown>,
): void {
  const errorMessage =
    error instanceof Error ? error.message : String(error);

  switch (category) {
    case ErrorCategory.CRITICAL:
      // Critical errors always throw
      throw error;

    case ErrorCategory.NON_CRITICAL:
      // Non-critical errors are logged but don't throw
      if (logger) {
        logger.error(
          {
            ...context,
            error: errorMessage,
          },
          "Non-critical error occurred, continuing operation",
        );
      }
      break;

    case ErrorCategory.RECOVERABLE:
      // Recoverable errors are logged with retry indication
      if (logger) {
        logger.warn(
          {
            ...context,
            error: errorMessage,
          },
          "Recoverable error occurred, should retry",
        );
      }
      // Don't throw - caller should implement retry logic
      break;
  }
}

/**
 * Determines the error category for an error.
 *
 * @param error - The error to categorize
 * @returns The error category
 */
export function categorizeError(error: unknown): ErrorCategory {
  if (isSequentialOrderingError(error)) {
    return ErrorCategory.CRITICAL;
  }
  // Default to non-critical for unknown errors
  // Callers can override based on context
  return ErrorCategory.NON_CRITICAL;
}

