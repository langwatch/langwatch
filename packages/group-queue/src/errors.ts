export class GroupQueueError extends Error {
  readonly queueName: string;
  readonly operation: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(
    queueName: string,
    operation: string,
    message: string,
    options: {
      cause?: unknown;
      retryable?: boolean;
      retryAfterMs?: number;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "GroupQueueError";
    this.queueName = queueName;
    this.operation = operation;
    this.retryable = options.retryable ?? true;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export class GroupQueueConfigurationError extends GroupQueueError {
  constructor(component: string, details: string) {
    super(component, "configure", `Configuration error in ${component}: ${details}`, {
      retryable: false,
    });
    this.name = "GroupQueueConfigurationError";
  }
}

export class NonRetryableGroupQueueError extends Error {
  readonly retryable = false;

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "NonRetryableGroupQueueError";
  }
}

export function defaultFailureDecision(error: unknown): {
  retryable: boolean;
  retryAfterMs?: number;
} {
  if (
    error instanceof NonRetryableGroupQueueError ||
    (error instanceof GroupQueueError && !error.retryable)
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

export function safeParseErrorText(error: unknown): string {
  return errorText(error).replaceAll(
    /(?:s3|azure-blob|gs|file):\/\/[^\s'"]+/gi,
    "<redacted-uri>",
  );
}
