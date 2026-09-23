import { NonRetryableGroupQueueError } from "@langwatch/group-queue";
import { HandledError } from "@langwatch/handled-error";
import type { createLogger } from "@langwatch/observability";

const TRANSIENT_NETWORK_CODES: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
]);

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
   * Examples: optional side effects, like push notifications
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
    this.name = "EventSourcingError";
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
  constructor(message: string, context: Record<string, unknown> = {}, cause?: unknown) {
    super(message, ErrorCategory.CRITICAL, context, cause);
  }
}

/**
 * Base class for recoverable errors that should trigger retry logic.
 */
export abstract class RecoverableError extends BaseEventSourcingError {
  constructor(message: string, context: Record<string, unknown> = {}, cause?: unknown) {
    super(message, ErrorCategory.RECOVERABLE, context, cause);
  }
}

/**
 * Base class for non-critical errors that should be logged but don't fail the operation.
 */
export abstract class NonCriticalError extends BaseEventSourcingError {
  constructor(message: string, context: Record<string, unknown> = {}, cause?: unknown) {
    super(message, ErrorCategory.NON_CRITICAL, context, cause);
  }
}

/**
 * Error thrown for security violations, particularly tenant isolation issues.
 */
export class SecurityError extends CriticalError {
  override readonly name = "SecurityError";
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
 * A queued job's payload tenant disagreed with its group-key tenant segment.
 * Non-retryable so the job dead-letters: the mismatch cannot heal on
 * re-delivery. Not forgery resistance (that needs per-tenant ACLs or signing).
 */
export class QueueTenantMismatchError extends NonRetryableGroupQueueError {
  override readonly name = "QueueTenantMismatchError";
  readonly payloadTenant: string;
  readonly groupTenant: string;
  readonly jobPath: string;

  constructor(params: {
    queueName: string;
    payloadTenant: string;
    groupTenant: string;
    jobPath: string;
  }) {
    super(
      `Job payload tenant "${params.payloadTenant}" does not match group-key tenant ` +
        `"${params.groupTenant}" on ${params.jobPath} (queue ${params.queueName}); ` +
        "refusing to process and dead-lettering the job",
    );
    this.payloadTenant = params.payloadTenant;
    this.groupTenant = params.groupTenant;
    this.jobPath = params.jobPath;
  }
}

/**
 * Error thrown when validation fails (invalid data, missing fields, etc.).
 */
export class ValidationError extends CriticalError {
  override readonly name = "ValidationError";
  readonly field?: string;
  readonly value?: unknown;
  readonly reason: string;

  constructor(
    reason: string,
    field?: string,
    value?: unknown,
    context: Record<string, unknown> = {},
  ) {
    const message = field ? `[VALIDATION] ${reason} (field: ${field})` : `[VALIDATION] ${reason}`;
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

/** A tenant-bound event-log read did not find the requested immutable event. */
export class EventNotFoundError extends CriticalError {
  override readonly name = "EventNotFoundError";

  constructor(context: { eventId: string; aggregateId: string; aggregateType: string }) {
    super("Event was not found in the requested tenant-bound aggregate stream", context);
  }
}

/**
 * Error thrown for configuration issues (missing handlers, invalid setup, etc.).
 */
export class ConfigurationError extends CriticalError {
  override readonly name = "ConfigurationError";
  readonly component: string;
  readonly details: string;

  constructor(component: string, details: string, context: Record<string, unknown> = {}) {
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
 * Error thrown for event store operation failures.
 * Can be critical or recoverable depending on the operation.
 */
export class StoreError extends BaseEventSourcingError {
  override readonly name = "StoreError";
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
 * Error thrown for queue operation failures.
 */
export class QueueError extends RecoverableError {
  override readonly name = "QueueError";
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
  override readonly name = "HandlerError";
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
  override readonly name = "ProjectionError";
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
 * Handle error by category; uses error's own category if BaseEventSourcingError.
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
      err: error,
    };

    switch (errorCategory) {
      case ErrorCategory.CRITICAL:
        // Critical errors always throw
        throw error;

      case ErrorCategory.NON_CRITICAL:
        // Non-critical errors are logged but don't throw
        if (logger) {
          logger.error(mergedContext, "Non-critical error occurred, continuing operation");
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
    return;
  }

  // Fallback for non-BaseEventSourcingError errors
  const errorMessage = error instanceof Error ? error.message : String(error);
  const mergedContext = {
    ...context,
    error: errorMessage,
    err: error,
  };

  switch (category) {
    case ErrorCategory.CRITICAL:
      // Critical errors always throw
      throw error;

    case ErrorCategory.NON_CRITICAL:
      // Non-critical errors are logged but don't throw
      if (logger) {
        logger.error(mergedContext, "Non-critical error occurred, continuing operation");
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
 * Determines the error category, using its own category for a
 * {@link BaseEventSourcingError} and inferring one otherwise.
 * @param error - The error to categorize
 * @returns The error category
 */
export function categorizeError(error: unknown): ErrorCategory {
  if (error instanceof BaseEventSourcingError) {
    return error.category;
  }

  // Default to recoverable for unknown errors, so they can be retried by default and
  // logged as warnings. If we're lucky, this will be all gucci.
  // Callers can override based on context
  return ErrorCategory.RECOVERABLE;
}

/**
 * ClickHouse transient/overload (159, 160, 202, 203, 209, 210, 241, 252) and
 * cluster-recovery codes (33, 236, 242, 394, 999); all are retryable.
 */
const CLICKHOUSE_TRANSIENT_CODES = new Set([
  "33",
  "159",
  "160",
  "202",
  "203",
  "209",
  "210",
  "236",
  "241",
  "242",
  "252",
  "394",
  "999",
]);

/**
 * Handled error codes that are themselves a transient verdict. Kept separate
 * from {@link CLICKHOUSE_TRANSIENT_CODES} (ClickHouse server codes read off the
 * CAUSE) since these are read off the handled shell and can't be matched by message.
 */
const TRANSIENT_HANDLED_CODES = new Set<string>(["clickhouse_overloaded"]);

/**
 * Message-fragment matchers for the same conditions as
 * CLICKHOUSE_TRANSIENT_CODES, used when the code is embedded in
 * `error.message` rather than a separate `code` property (HTTP responses).
 */
export const CLICKHOUSE_TRANSIENT_MESSAGE_FRAGMENTS = [
  "Too many simultaneous queries",
  "TIMEOUT_EXCEEDED",
  "SOCKET_TIMEOUT",
  "NETWORK_ERROR",
  "MEMORY_LIMIT_EXCEEDED",
  "connect ECONNREFUSED",
  "connect ETIMEDOUT",
  "QUERY_WAS_CANCELLED",
  "Query was cancelled",
  "TABLE_IS_READ_ONLY",
  "Table is in readonly mode",
  "KEEPER_EXCEPTION",
  "Coordination::Exception",
  "Session expired",
  "Connection loss",
  "CANNOT_READ_ALL_DATA",
  "Write buffer has been canceled",
  // The peer closed the connection before answering. Normally carries an
  // errno matched by TRANSIENT_NETWORK_CODES, but the message is all that
  // survives an error that crossed a worker or serialisation boundary, and
  // it is the only form that reaches the logs. "socket hang up" is Node's
  // http module; "other side closed" is undici's.
  "socket hang up",
  "other side closed",
] as const;

/**
 * Classifies a ClickHouse error as RECOVERABLE (transient) or CRITICAL.
 * Transient errors (overload, timeouts, connection issues, ZK / cluster
 * recovery) should be retried by the group queue; only data-integrity errors are CRITICAL.
 */
export function classifyClickHouseError(error: unknown): ErrorCategory {
  // Handled codes like clickhouse_overloaded ARE the verdict; classifying only
  // by reasons would wrongly mark shed statements CRITICAL.
  if (HandledError.isHandled(error) && TRANSIENT_HANDLED_CODES.has(error.code)) {
    return ErrorCategory.RECOVERABLE;
  }

  // The resilient client's query translation wraps the raw driver error in a
  // HandledError's `reasons` — classify the wrapped causes, not the handled
  // shell. Single shallow pass: the translation wraps the driver error
  // directly, no deep recursion needed.
  const candidates =
    HandledError.isHandled(error) && (error.reasons ?? []).length > 0 ? error.reasons : [error];

  for (const candidate of candidates) {
    if (isTransientClickHouseError(candidate)) {
      return ErrorCategory.RECOVERABLE;
    }
  }
  return ErrorCategory.CRITICAL;
}

function isTransientClickHouseError(error: unknown): boolean {
  if (error != null && typeof error === "object" && "code" in error) {
    const code = String((error as { code: unknown }).code);
    // Two disjoint namespaces share the one `code` field: ClickHouse's own
    // numeric codes on server-side exceptions, Node's socket errnos when the
    // request never got an answer. Checking only the former made `socket hang
    // up` (ECONNRESET) CRITICAL, dead-lettering jobs a worker rollout aborted
    // instead of re-staging them.
    if (CLICKHOUSE_TRANSIENT_CODES.has(code)) return true;
    if (TRANSIENT_NETWORK_CODES.has(code)) return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  for (const fragment of CLICKHOUSE_TRANSIENT_MESSAGE_FRAGMENTS) {
    if (message.includes(fragment)) {
      return true;
    }
  }

  return false;
}
