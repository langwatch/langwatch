export class GroupQueueError extends Error {
  readonly queueName: string;
  readonly operation: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor({
    queueName,
    operation,
    message,
    cause,
    retryable = true,
    retryAfterMs,
  }: {
    queueName: string;
    operation: string;
    message: string;
    cause?: unknown;
    retryable?: boolean;
    retryAfterMs?: number;
  }) {
    super(message, { cause });
    this.name = "GroupQueueError";
    this.queueName = queueName;
    this.operation = operation;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

export class GroupQueueConfigurationError extends GroupQueueError {
  constructor(component: string, details: string) {
    super({
      queueName: component,
      operation: "configure",
      message: `Configuration error in ${component}: ${details}`,
      retryable: false,
    });
    this.name = "GroupQueueConfigurationError";
  }
}

/**
 * A send refused because this queue's drain has finished. During shutdown it is
 * expected (a job whose drain overran its budget is still running), and the caller
 * keeps the work for re-drive, so callers may log it below error level.
 */
export class QueueStagingClosedError extends GroupQueueError {
  constructor({ queueName, operation }: { queueName: string; operation: "send" | "sendBatch" | "sendEach" }) {
    super({ queueName, operation, message: "Cannot send to queue after its drain has finished" });
    this.name = "QueueStagingClosedError";
  }
}

/** By name, not class, so a second copy of this package still recognises it. */
export function isQueueStagingClosed(error: unknown): boolean {
  return error instanceof Error && error.name === "QueueStagingClosedError";
}

export class NonRetryableGroupQueueError extends Error {
  readonly retryable = false;

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "NonRetryableGroupQueueError";
  }
}

/**
 * The worker has no handler for this job (mid rolling deploy, a newer release's kind): the queue
 * hands it back unspent, no attempt used and no failure counted, so a worker that knows it runs it.
 */
export class HandBackGroupQueueError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "HandBackGroupQueueError";
  }
}

/** Fault kinds a refusal names when its cause may pass on its own (HandledError's vocabulary). */
const TRANSIENT_FAULTS: ReadonlySet<unknown> = new Set([
  "platform",
  "presumed_platform",
  "provider",
]);

/**
 * An error that says `retryable: false` (a HandledError, a DispatchError) fails the same way on
 * every attempt, unless it names a platform or provider fault or a 429 or unattributed 5xx
 * status: there `retryable: false` is only HandledError's default, so it still retries (ADR-027).
 */
export function refusesRetry(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (Reflect.get(error, "retryable") !== false) return false;
  const fault = Reflect.get(error, "fault");
  const status = Reflect.get(error, "httpStatus");
  if (status === 429 || TRANSIENT_FAULTS.has(fault)) return false;
  return !(fault === undefined && typeof status === "number" && status >= 500);
}

export function defaultFailureDecision(error: unknown): {
  retryable: boolean;
  retryAfterMs?: number;
} {
  if (
    error instanceof NonRetryableGroupQueueError ||
    (error instanceof GroupQueueError && !error.retryable) ||
    refusesRetry(error)
  ) {
    return { retryable: false };
  }
  if (error instanceof GroupQueueError && error.retryAfterMs !== undefined) {
    return { retryable: true, retryAfterMs: error.retryAfterMs };
  }
  return { retryable: true };
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A parse-failure error's own message quotes the offending input (V8 echoes
 * it into `SyntaxError`), so it is never safe to surface. Name only the error
 * class — the diagnosis a caller needs without the payload it parsed.
 */
export function safeParseErrorText(error: unknown): string {
  return error instanceof Error ? error.constructor.name : "unknown error";
}
