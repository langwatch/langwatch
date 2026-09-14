import { nowInstant, toEpochMs } from "@langwatch/time";
/** Typed error to signal if a dispatch failure is retryable (see ADR-027). */
export class DispatchError extends Error {
  readonly retryable: boolean;
  readonly cause?: unknown;
  /**
   * Optional minimum backoff before the next attempt, in ms — set from a
   * receiver's `Retry-After` (ADR-040 §5, ADR-027 extension). The retry
   * scheduler treats it as a FLOOR over its own exponential backoff, so it
   * can lengthen but never shorten the wait. Only meaningful when
   * `retryable` is true.
   */
  readonly retryAfterMs?: number;
  /**
   * The remediation sentence, written for a customer, when this rejection has
   * one — a provider saying "the bot isn't in that channel" is worth relaying
   * verbatim. Absent for transport failures: `message` there is assembled from
   * an undici string, a DNS result and a label naming how the feature is built,
   * none of which is prose for a person. Only this field is lifted onto
   * `meta.message`; `message` stays the full diagnostic for the log line.
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
 * delta-seconds form (`Retry-After: 120`) and the HTTP-date form
 * (`Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`). Returns undefined for a
 * missing/unparseable value or a date already in the past. Capped so a
 * hostile receiver can't pin a job for hours.
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

/** Best-effort extraction of HTTP status from dispatch provider errors. */
export function extractHttpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const e = error as Record<string, any>;
  const candidates = [
    e.$metadata?.httpStatusCode,
    e.response?.status,
    e.response?.statusCode,
    e.statusCode,
    e.status,
    e.original?.response?.status,
    e.original?.response?.statusCode,
    typeof e.code === "number" ? e.code : undefined,
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
