import { nowInstant, toEpochMs } from "@langwatch/time";
/** Typed error to signal if a dispatch failure is retryable (see ADR-027). */
export class DispatchError extends Error {
  readonly retryable: boolean;
  readonly cause?: unknown;
  /**
   * Optional minimum backoff before the next attempt, in ms — set from a
   * receiver's `Retry-After` (ADR-040 §5). The retry scheduler treats it as a
   * FLOOR over its own exponential backoff — can lengthen, never shorten.
   */
  readonly retryAfterMs?: number;
  /**
   * The remediation sentence, written for a customer, when this rejection has
   * one (e.g. "the bot isn't in that channel"). Absent for transport failures,
   * whose `message` is assembled from internals not fit for a person to read.
   */
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

/**
 * Parse an HTTP `Retry-After` header into milliseconds. Supports both the
 * delta-seconds and HTTP-date forms; returns undefined for a missing,
 * unparseable, or past value. Capped so a hostile receiver can't pin a job for hours.
 */
const MAX_RETRY_AFTER_MS = 60 * 60 * 1000; // 1h
export function parseRetryAfterMs(
  headerValue: string | null | undefined,
  now: number = nowInstant().epochMilliseconds,
): number | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  if (/^\d+$/.test(trimmed)) {
    const ms = parseInt(trimmed, 10) * 1000;
    return Math.min(ms, MAX_RETRY_AFTER_MS);
  }
  const date = toEpochMs(trimmed);
  if (Number.isNaN(date)) return undefined;
  const delta = date - now;
  if (delta <= 0) return undefined;
  return Math.min(delta, MAX_RETRY_AFTER_MS);
}

export function isDispatchError(error: unknown): error is DispatchError {
  return error instanceof DispatchError;
}

/**
 * Whether an HTTP status warrants a retry, per ADR-027:
 *   - 429 (rate limited) and 5xx (server error) → retry with backoff
 *   - any other 4xx → terminal (revoked webhook, bad request, auth failure)
 */
export function isRetryableHttpStatus(status: number): boolean {
  if (status === 429) return true;
  return status >= 500 && status < 600;
}

function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (current === null || (typeof current !== "object" && typeof current !== "function")) {
      return undefined;
    }
    current = Reflect.get(current, key);
  }
  return current;
}

/** Best-effort extraction of HTTP status from dispatch provider errors. */
export function extractHttpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = readPath(error, ["code"]);
  const candidates = [
    readPath(error, ["$metadata", "httpStatusCode"]),
    readPath(error, ["response", "status"]),
    readPath(error, ["response", "statusCode"]),
    readPath(error, ["statusCode"]),
    readPath(error, ["status"]),
    readPath(error, ["original", "response", "status"]),
    readPath(error, ["original", "response", "statusCode"]),
    typeof code === "number" ? code : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && candidate >= 100 && candidate < 600) {
      return candidate;
    }
  }
  return undefined;
}

/** Convert raw dispatch failure to DispatchError with retryable decision from HTTP status. */
export function toDispatchError(
  error: unknown,
  { message, retryable: retryableOverride }: { message: string; retryable?: boolean },
): DispatchError {
  if (isDispatchError(error)) return error;
  if (retryableOverride !== undefined) {
    return new DispatchError({
      message,
      retryable: retryableOverride,
      cause: error,
    });
  }
  const status = extractHttpStatus(error);
  const retryable = status === undefined ? true : isRetryableHttpStatus(status);
  return new DispatchError({ message, retryable, cause: error });
}
