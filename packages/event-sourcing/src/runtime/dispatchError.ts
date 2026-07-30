/**
 * How an intent's delivery says whether a failure is worth retrying. An
 * endpoint that logs and returns leaves the outbox unable to tell success from
 * silence (ADR-108 decision 11).
 */
export class DispatchError extends Error {
  readonly retryable: boolean;
  readonly cause?: unknown;
  /** A receiver's `Retry-After`, treated as a FLOOR over the scheduler's own
   *  backoff — it can lengthen the wait, never shorten it. */
  readonly retryAfterMs?: number;
  /** The remediation sentence when the rejection has one worth relaying to a
   *  customer. Absent for transport failures, whose `message` is assembled from
   *  a socket error and is not prose for a person. */
  readonly customerMessage?: string;

  constructor({
    message,
    retryable,
    cause,
    retryAfterMs,
    customerMessage,
  }: {
    message: string;
    retryable: boolean;
    cause?: unknown;
    retryAfterMs?: number;
    customerMessage?: string;
  }) {
    super(message);
    this.name = "DispatchError";
    this.retryable = retryable;
    this.cause = cause;
    this.retryAfterMs = retryAfterMs;
    this.customerMessage = customerMessage;
  }
}

const MAX_RETRY_AFTER_MS = 60 * 60 * 1000;

/** Parses `Retry-After` in both delta-seconds and HTTP-date forms. Capped, so a
 *  hostile receiver cannot pin a job for hours. */
export function parseRetryAfterMs(
  headerValue: string | null | undefined,
  now: number,
): number | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number.parseInt(trimmed, 10) * 1000, MAX_RETRY_AFTER_MS);
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  const delta = date - now;
  if (delta <= 0) return undefined;
  return Math.min(delta, MAX_RETRY_AFTER_MS);
}

export function isDispatchError(error: unknown): error is DispatchError {
  return error instanceof DispatchError;
}

/** 429 and 5xx are worth another attempt; every other 4xx is terminal. */
export function isRetryableHttpStatus(status: number): boolean {
  if (status === 429) return true;
  return status >= 500 && status < 600;
}

/**
 * Best-effort status extraction across the shapes providers raise (AWS SDK v3,
 * axios, SendGrid, fetch). `code` is read only when numeric: SendGrid uses a
 * numeric `code` for the status, while Node transport errors use a string one.
 */
export function extractHttpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as Record<string, unknown>;
  const nested = (key: string, inner: string): unknown => {
    const value = candidate[key];
    if (typeof value !== "object" || value === null) return undefined;
    return (value as Record<string, unknown>)[inner];
  };
  const original = candidate.original;
  const originalResponse =
    typeof original === "object" && original !== null
      ? (original as Record<string, unknown>).response
      : undefined;
  const candidates = [
    nested("$metadata", "httpStatusCode"),
    nested("response", "status"),
    nested("response", "statusCode"),
    candidate.statusCode,
    candidate.status,
    typeof originalResponse === "object" && originalResponse !== null
      ? (originalResponse as Record<string, unknown>).status
      : undefined,
    typeof originalResponse === "object" && originalResponse !== null
      ? (originalResponse as Record<string, unknown>).statusCode
      : undefined,
    typeof candidate.code === "number" ? candidate.code : undefined,
  ];
  for (const value of candidates) {
    if (typeof value === "number" && value >= 100 && value < 600) return value;
  }
  return undefined;
}

/**
 * Turns a raw failure into a classified one. A failure carrying no recognisable
 * status defaults to retryable — better to retry an unclassified crash than to
 * dead-letter a row whose failure mode we never named.
 */
export function toDispatchError(
  error: unknown,
  { message, retryable }: { message: string; retryable?: boolean },
): DispatchError {
  if (isDispatchError(error)) return error;
  if (retryable !== undefined) {
    return new DispatchError({ message, retryable, cause: error });
  }
  const status = extractHttpStatus(error);
  return new DispatchError({
    message,
    retryable: status === undefined ? true : isRetryableHttpStatus(status),
    cause: error,
  });
}
