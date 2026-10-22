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

  constructor({
    message,
    category,
    context = {},
    cause,
  }: {
    message: string;
    category: ErrorCategory;
    context?: Record<string, unknown>;
    cause?: unknown;
  }) {
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
    super({ message, category: ErrorCategory.CRITICAL, context, cause });
  }
}

/**
 * Base class for recoverable errors that should trigger retry logic.
 */
export abstract class RecoverableError extends BaseEventSourcingError {
  constructor(message: string, context: Record<string, unknown> = {}, cause?: unknown) {
    super({ message, category: ErrorCategory.RECOVERABLE, context, cause });
  }
}

/**
 * Base class for non-critical errors that should be logged but don't fail the operation.
 */
export abstract class NonCriticalError extends BaseEventSourcingError {
  constructor(message: string, context: Record<string, unknown> = {}, cause?: unknown) {
    super({ message, category: ErrorCategory.NON_CRITICAL, context, cause });
  }
}

/**
 * Error thrown for security violations, particularly tenant isolation issues.
 */
export class SecurityError extends CriticalError {
  override readonly name = "SecurityError";
  readonly operation: string;
  readonly tenantId?: string;

  constructor({
    operation,
    message,
    tenantId,
    context = {},
  }: {
    operation: string;
    message: string;
    tenantId?: string;
    context?: Record<string, unknown>;
  }) {
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

/** The issues on the message itself: the group's stored error keeps only the message. */
function describeIssues(
  issues: readonly { path: string; code: string; message: string }[],
): string {
  return issues
    .map(({ path, code, message }) => `${path || "(root)"} [${code}] ${message}`)
    .join("; ");
}

/**
 * A queued command payload failed its schema at dispatch. It was validated at
 * send, so this is corruption or schema drift and cannot heal on re-delivery:
 * non-retryable, so the GroupQueue skips retries and blocks the group (restageAndBlock).
 */
export class QueuedCommandPayloadInvalidError extends NonRetryableGroupQueueError {
  override readonly name = "QueuedCommandPayloadInvalidError";
  readonly pipelineName: string;
  readonly commandName: string;
  readonly commandType: string;
  readonly issues: { path: string; code: string; message: string }[];

  constructor(params: {
    pipelineName: string;
    commandName: string;
    commandType: string;
    issues: { path: string; code: string; message: string }[];
  }) {
    super(
      `Queued payload for command "${params.commandName}" (${params.commandType}) on pipeline ` +
        `"${params.pipelineName}" failed its schema at dispatch; refusing it: ${describeIssues(params.issues)}`,
    );
    this.pipelineName = params.pipelineName;
    this.commandName = params.commandName;
    this.commandType = params.commandType;
    this.issues = params.issues;
  }
}

/**
 * A dequeued job whose payload its lane's schema no longer reads. Non-retryable: the GroupQueue
 * skips retries and blocks the group, the job kept, until an operator unblocks it or moves the
 * group to the ops DLQ (MoveQueueGroupToDlq), from which it stays redrivable.
 */
export class QueuedPayloadInvalidError extends NonRetryableGroupQueueError {
  override readonly name = "QueuedPayloadInvalidError";
  readonly jobPath: string;
  readonly issues: { path: string; code: string; message: string }[];

  constructor(params: {
    jobPath: string;
    issues: { path: string; code: string; message: string }[];
  }) {
    super(
      `Queued payload for "${params.jobPath}" failed its schema at dispatch; refusing it: ${describeIssues(params.issues)}`,
    );
    this.jobPath = params.jobPath;
    this.issues = params.issues;
  }
}

/**
 * A dequeued event whose type nothing on this worker declares: mid rolling deploy, an older
 * worker took a newer release's event. The queue hands it back unspent for a worker declaring it
 * (Alex, 2026-10-12); past the hand-back window it spends attempts and exhausts like any job (§9).
 */
export class UndeclaredQueuedEventTypeError extends RecoverableError {
  override readonly name = "UndeclaredQueuedEventTypeError";
  readonly eventType: string;
  readonly declaredBy: string;

  constructor({ eventType, declaredBy }: { eventType: string; declaredBy: string }) {
    super(
      `Queued event type "${eventType}" is not declared by ${declaredBy} on this worker; ` +
        "handing it back so a worker that declares it takes the job (rolling-deploy drain)",
      { eventType, declaredBy },
    );
    this.eventType = eventType;
    this.declaredBy = declaredBy;
  }
}

/**
 * A dequeued job no registration, drain or alias on this worker routes. The group queue hands it
 * back without using an attempt so a worker that routes it takes it (Alex, 2026-10-12); handed back
 * past HAND_BACK_CONFIG.windowMs it spends attempts, then is dead-lettered (Alex, 2026-10-10).
 */
export class UnroutableQueuedJobError extends RecoverableError {
  override readonly name = "UnroutableQueuedJobError";
  readonly queueName: string;
  readonly jobPath: string;

  constructor({
    queueName,
    jobPath,
    context,
  }: {
    queueName: string;
    jobPath: string;
    context: Record<string, unknown>;
  }) {
    super(
      `Queued job "${jobPath}" on ${queueName}: job routing key is not registered in this worker; ` +
        "handing it back for a worker that routes it, then dead-lettering it if none does",
      { ...context, queueName, jobPath },
    );
    this.queueName = queueName;
    this.jobPath = jobPath;
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

  constructor({
    reason,
    field,
    value,
    context = {},
  }: {
    reason: string;
    field?: string;
    value?: unknown;
    context?: Record<string, unknown>;
  }) {
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
  /** The read already covered the aggregate's whole stream, so a wider read finds nothing more. */
  readonly wholeStream: boolean;

  constructor(context: {
    eventId: string;
    aggregateId: string;
    aggregateType: string;
    wholeStream?: boolean | undefined;
  }) {
    super("Event was not found in the requested tenant-bound aggregate stream", context);
    this.wholeStream = context.wholeStream === true;
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

  constructor({
    operation,
    store,
    message,
    category,
    context = {},
    cause,
  }: {
    operation: string;
    store: string;
    message: string;
    category: ErrorCategory;
    context?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super({ message, category, context: { ...context, operation, store }, cause });
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

  constructor({
    queueName,
    operation,
    message,
    context = {},
    cause,
  }: {
    queueName: string;
    operation: string;
    message: string;
    context?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(message, { ...context, queueName, operation }, cause);
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

  constructor({
    handlerName,
    eventId,
    message,
    context = {},
    cause,
  }: {
    handlerName: string;
    eventId: string;
    message: string;
    context?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(message, { ...context, handlerName, eventId }, cause);
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

  constructor({
    projectionName,
    eventId,
    message,
    context = {},
    cause,
  }: {
    projectionName: string;
    eventId: string;
    message: string;
    context?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(message, { ...context, projectionName, eventId }, cause);
    this.projectionName = projectionName;
    this.eventId = eventId;
  }
}

/**
 * Handle error by category; uses error's own category if BaseEventSourcingError.
 * @throws {Error} If category is CRITICAL
 */
export function handleError({
  error,
  category,
  logger,
  context,
}: {
  error: unknown;
  category: ErrorCategory;
  logger?: ReturnType<typeof createLogger>;
  context?: Record<string, unknown>;
}): void {
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
 * The fragments one statement is retried on in place by the resilient ClickHouse client.
 * MEMORY_LIMIT_EXCEEDED is left out: it fails the same way every time, so only the group
 * queue re-stages that job, minutes later, when the pressure may have cleared.
 */
export const CLICKHOUSE_STATEMENT_RETRY_MESSAGE_FRAGMENTS: readonly string[] =
  CLICKHOUSE_TRANSIENT_MESSAGE_FRAGMENTS.filter((fragment) => fragment !== "MEMORY_LIMIT_EXCEEDED");

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

const PROJECT_GONE_NAME = "ProjectNotFoundError";
const PROJECT_GONE_CODE = "project_not_found";
const MAX_CAUSE_DEPTH = 8;

/** ClickHouse's per-query memory limit, in both its older and newer wording. */
const QUERY_MEMORY_LIMIT_FRAGMENTS = [
  "Query memory limit exceeded",
  "Memory limit (for query) exceeded",
] as const;

/**
 * Whether one statement outgrew its own memory limit, read through causes and handled
 * reasons. The server-wide `(total)` limit and the client's own shedding are load, not size.
 */
export function isQueryMemoryLimitExceeded(error: unknown): boolean {
  return queryMemoryLimitAt({ error, depth: 0 });
}

function queryMemoryLimitAt({ error, depth }: { error: unknown; depth: number }): boolean {
  if (depth > MAX_CAUSE_DEPTH || error === null || typeof error !== "object") return false;
  const message = Reflect.get(error, "message");
  if (
    typeof message === "string" &&
    QUERY_MEMORY_LIMIT_FRAGMENTS.some((fragment) => message.includes(fragment))
  ) {
    return true;
  }
  const reasons: unknown = HandledError.isHandled(error) ? error.reasons : undefined;
  if (Array.isArray(reasons)) {
    for (const reason of reasons) {
      if (queryMemoryLimitAt({ error: reason, depth: depth + 1 })) return true;
    }
  }
  return queryMemoryLimitAt({ error: Reflect.get(error, "cause"), depth: depth + 1 });
}

/**
 * Whether a failure says its project no longer exists: authorization's and project's
 * ProjectNotFoundError, read by name or code anywhere in the cause chain, or every member
 * of an AggregateError. Structural, so no package imports another's error class.
 */
export function isProjectGone(error: unknown): boolean {
  return projectGoneAt({ error, depth: 0 });
}

function projectGoneAt({ error, depth }: { error: unknown; depth: number }): boolean {
  if (depth > MAX_CAUSE_DEPTH || error === null || typeof error !== "object") return false;
  if (error instanceof AggregateError) {
    const members: unknown[] = error.errors;
    return (
      members.length > 0 &&
      members.every((member) => projectGoneAt({ error: member, depth: depth + 1 }))
    );
  }
  if (Reflect.get(error, "name") === PROJECT_GONE_NAME) return true;
  if (Reflect.get(error, "code") === PROJECT_GONE_CODE) return true;
  return projectGoneAt({ error: Reflect.get(error, "cause"), depth: depth + 1 });
}
