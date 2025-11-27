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
 * Base error class for all event-sourcing errors.
 * Provides structured error information with category, context, and optional cause.
 */
export abstract class BaseEventSourcingError extends Error {
  readonly category: ErrorCategory;
  readonly context: Record<string, unknown>;
  readonly cause?: unknown;

  constructor(
    message: string,
    category: ErrorCategory,
    context: Record<string, unknown> = {},
    cause?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.category = category;
    this.context = context;
    this.cause = cause;

    // Maintains proper stack trace for where our error was thrown (only available on V8 runtimes)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Gets all context properties as a flat object for logging.
   */
  getLogContext(): Record<string, unknown> {
    return {
      ...this.context,
      errorName: this.name,
      errorMessage: this.message,
      errorCategory: this.category,
    };
  }
}

/**
 * Base class for critical errors that must cause operation to fail immediately.
 */
export abstract class CriticalError extends BaseEventSourcingError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    cause?: unknown,
  ) {
    super(message, ErrorCategory.CRITICAL, context, cause);
  }
}

/**
 * Base class for recoverable errors that should trigger retry logic.
 */
export abstract class RecoverableError extends BaseEventSourcingError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    cause?: unknown,
  ) {
    super(message, ErrorCategory.RECOVERABLE, context, cause);
  }
}

/**
 * Base class for non-critical errors that should be logged but don't fail the operation.
 */
export abstract class NonCriticalError extends BaseEventSourcingError {
  constructor(
    message: string,
    context: Record<string, unknown> = {},
    cause?: unknown,
  ) {
    super(message, ErrorCategory.NON_CRITICAL, context, cause);
  }
}

/**
 * Error thrown when event ordering is violated.
 * Indicates that a previous event has not been processed yet.
 */
export class SequentialOrderingError extends CriticalError {
  readonly previousSequenceNumber: number;
  readonly currentSequenceNumber: number;
  readonly eventId: string;
  readonly aggregateId: string;
  readonly tenantId: string;

  constructor(
    previousSequenceNumber: number,
    currentSequenceNumber: number,
    eventId: string,
    aggregateId: string,
    tenantId: string,
    context: Record<string, unknown> = {},
  ) {
    const message = `Previous event (sequence ${previousSequenceNumber}) has not been processed yet. Processing stopped to maintain event ordering.`;
    super(message, {
      ...context,
      previousSequenceNumber,
      currentSequenceNumber,
      eventId,
      aggregateId,
      tenantId,
    });
    this.previousSequenceNumber = previousSequenceNumber;
    this.currentSequenceNumber = currentSequenceNumber;
    this.eventId = eventId;
    this.aggregateId = aggregateId;
    this.tenantId = tenantId;
  }
}

/**
 * Error thrown for security violations, particularly tenant isolation issues.
 */
export class SecurityError extends CriticalError {
  readonly operation: string;
  readonly tenantId?: string;

  constructor(
    operation: string,
    message: string,
    tenantId?: string,
    context: Record<string, unknown> = {},
  ) {
    super(`[SECURITY] ${message}`, {
      ...context,
      operation,
      tenantId,
    });
    this.operation = operation;
    this.tenantId = tenantId;
  }
}

/**
 * Error thrown when validation fails (invalid data, missing fields, etc.).
 */
export class ValidationError extends CriticalError {
  readonly field?: string;
  readonly value?: unknown;
  readonly reason: string;

  constructor(
    reason: string,
    field?: string,
    value?: unknown,
    context: Record<string, unknown> = {},
  ) {
    const message = field
      ? `[VALIDATION] ${reason} (field: ${field})`
      : `[VALIDATION] ${reason}`;
    super(message, {
      ...context,
      field,
      value,
      reason,
    });
    this.field = field;
    this.value = value;
    this.reason = reason;
  }
}

/**
 * Error thrown for configuration issues (missing handlers, invalid setup, etc.).
 */
export class ConfigurationError extends CriticalError {
  readonly component: string;
  readonly details: string;

  constructor(
    component: string,
    details: string,
    context: Record<string, unknown> = {},
  ) {
    super(`Configuration error in ${component}: ${details}`, {
      ...context,
      component,
      details,
    });
    this.component = component;
    this.details = details;
  }
}

/**
 * Error thrown for checkpoint key validation and format errors.
 */
export class CheckpointError extends CriticalError {
  readonly component: string;
  readonly value: string;

  constructor(
    component: string,
    value: string,
    message: string,
    context: Record<string, unknown> = {},
  ) {
    super(message, {
      ...context,
      component,
      value,
    });
    this.component = component;
    this.value = value;
  }
}

/**
 * Error thrown for event store operation failures.
 * Can be critical or recoverable depending on the operation.
 */
export class StoreError extends BaseEventSourcingError {
  readonly operation: string;
  readonly store: string;

  constructor(
    operation: string,
    store: string,
    message: string,
    category: ErrorCategory,
    context: Record<string, unknown> = {},
    cause?: unknown,
  ) {
    super(
      message,
      category,
      {
        ...context,
        operation,
        store,
      },
      cause,
    );
    this.operation = operation;
    this.store = store;
  }
}

/**
 * Error thrown when distributed lock acquisition fails.
 */
export class LockError extends RecoverableError {
  readonly lockKey: string;
  readonly operation: string;

  constructor(
    lockKey: string,
    operation: string,
    message: string,
    context: Record<string, unknown> = {},
  ) {
    super(message, {
      ...context,
      lockKey,
      operation,
    });
    this.lockKey = lockKey;
    this.operation = operation;
  }
}

/**
 * Error thrown for queue operation failures.
 */
export class QueueError extends RecoverableError {
  readonly queueName: string;
  readonly operation: string;

  constructor(
    queueName: string,
    operation: string,
    message: string,
    context: Record<string, unknown> = {},
    cause?: unknown,
  ) {
    super(
      message,
      {
        ...context,
        queueName,
        operation,
      },
      cause,
    );
    this.queueName = queueName;
    this.operation = operation;
  }
}

/**
 * Error thrown when handler execution fails.
 */
export class HandlerError extends NonCriticalError {
  readonly handlerName: string;
  readonly eventId: string;

  constructor(
    handlerName: string,
    eventId: string,
    message: string,
    context: Record<string, unknown> = {},
    cause?: unknown,
  ) {
    super(
      message,
      {
        ...context,
        handlerName,
        eventId,
      },
      cause,
    );
    this.handlerName = handlerName;
    this.eventId = eventId;
  }
}

/**
 * Error thrown when projection execution fails.
 */
export class ProjectionError extends NonCriticalError {
  readonly projectionName: string;
  readonly eventId: string;

  constructor(
    projectionName: string,
    eventId: string,
    message: string,
    context: Record<string, unknown> = {},
    cause?: unknown,
  ) {
    super(
      message,
      {
        ...context,
        projectionName,
        eventId,
      },
      cause,
    );
    this.projectionName = projectionName;
    this.eventId = eventId;
  }
}

/**
 * Error thrown when event publishing fails.
 */
export class PublishingError extends NonCriticalError {
  readonly eventId: string;
  readonly channel?: string;

  constructor(
    eventId: string,
    message: string,
    channel?: string,
    context: Record<string, unknown> = {},
    cause?: unknown,
  ) {
    super(
      message,
      {
        ...context,
        eventId,
        channel,
      },
      cause,
    );
    this.eventId = eventId;
    this.channel = channel;
  }
}

/**
 * Determines if an error is a sequential ordering violation.
 * These are critical errors that must cause the operation to fail.
 */
export function isSequentialOrderingError(error: unknown): boolean {
  return (
    error instanceof SequentialOrderingError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { name?: string }).name === "SequentialOrderingError")
  );
}

/**
 * Extracts the previous sequence number from an ordering error.
 * Returns null if the error is not an ordering error.
 *
 * @param error - The error to extract the sequence number from
 * @returns The previous sequence number, or null if not found
 */
export function extractPreviousSequenceNumber(error: unknown): number | null {
  if (error instanceof SequentialOrderingError) {
    return error.previousSequenceNumber;
  }
  return null;
}

/**
 * Handles an error according to its category.
 * If the error is a BaseEventSourcingError, uses its category and context.
 * Otherwise, uses the provided category and context.
 *
 * @param error - The error to handle
 * @param category - The error category (used if error is not a BaseEventSourcingError)
 * @param logger - Optional logger for non-critical errors
 * @param context - Additional context for logging (merged with error context if available)
 * @throws {Error} If category is CRITICAL
 */
export function handleError(
  error: unknown,
  category: ErrorCategory,
  logger?: ReturnType<typeof createLogger>,
  context?: Record<string, unknown>,
): void {
  // If error is a BaseEventSourcingError, use its category and merge contexts
  if (error instanceof BaseEventSourcingError) {
    const errorCategory = error.category;
    const mergedContext = {
      ...error.getLogContext(),
      ...context,
    };

    switch (errorCategory) {
      case ErrorCategory.CRITICAL:
        // Critical errors always throw
        throw error;

      case ErrorCategory.NON_CRITICAL:
        // Non-critical errors are logged but don't throw
        if (logger) {
          logger.error(
            mergedContext,
            "Non-critical error occurred, continuing operation",
          );
        }
        break;

      case ErrorCategory.RECOVERABLE:
        // Recoverable errors are logged with retry indication
        if (logger) {
          logger.warn(
            mergedContext,
            "Recoverable error occurred, should retry",
          );
        }
        // Don't throw - caller should implement retry logic
        break;
    }
    return;
  }

  // Fallback for non-BaseEventSourcingError errors
  const errorMessage = error instanceof Error ? error.message : String(error);
  const mergedContext = {
    ...context,
    error: errorMessage,
  };

  switch (category) {
    case ErrorCategory.CRITICAL:
      // Critical errors always throw
      throw error;

    case ErrorCategory.NON_CRITICAL:
      // Non-critical errors are logged but don't throw
      if (logger) {
        logger.error(
          mergedContext,
          "Non-critical error occurred, continuing operation",
        );
      }
      break;

    case ErrorCategory.RECOVERABLE:
      // Recoverable errors are logged with retry indication
      if (logger) {
        logger.warn(mergedContext, "Recoverable error occurred, should retry");
      }
      // Don't throw - caller should implement retry logic
      break;
  }
}

/**
 * Determines the error category for an error.
 * If the error is a BaseEventSourcingError, uses its category.
 * Otherwise, attempts to infer the category from the error type.
 *
 * @param error - The error to categorize
 * @returns The error category
 */
export function categorizeError(error: unknown): ErrorCategory {
  if (error instanceof BaseEventSourcingError) {
    return error.category;
  }

  if (isSequentialOrderingError(error)) {
    return ErrorCategory.CRITICAL;
  }

  // Default to recoverable for unknown errors, so they can be retried by default and
  // logged as warnings. If we're lucky, this will be all gucci.
  // Callers can override based on context
  return ErrorCategory.RECOVERABLE;
}
