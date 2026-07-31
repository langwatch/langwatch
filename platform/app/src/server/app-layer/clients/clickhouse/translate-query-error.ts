import {
  ClickHouseUnavailableError,
  QueryMemoryExceededError,
  QueryTimeoutError,
} from "~/server/app-layer/traces/errors";
import { toError } from "~/utils/posthogErrorCapture";

/** Errno codes for connection-level failures (shared with the retry loop). */
export const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

/**
 * Translates a raw ClickHouse driver error into a typed `HandledError` for the
 * read path, after the resilient client's retries are exhausted. The raw error
 * is preserved in `reasons` — retry classifiers
 * (`event-sourcing/services/errorHandling.classifyClickHouseError`) and batch
 * splitters (`traces/clickhouse-trace.service.isClickHouseMemoryLimitError`)
 * unwrap it, so background consumers keep seeing the transient condition they
 * retry on while users get an actionable error with remediation tips.
 *
 * Mapped:
 * - MEMORY_LIMIT_EXCEEDED (241) → `QueryMemoryExceededError` — the caller can
 *   shrink the query (narrow range, more filters, fewer fields).
 * - TIMEOUT_EXCEEDED (159) → `QueryTimeoutError` — same remediation.
 * - Connection-level failure (network errno, 502/503) →
 *   `ClickHouseUnavailableError` — platform incident, retry shortly.
 *
 * Anything else passes through untouched: an unmapped error is genuinely
 * unhandled and must degrade to "unknown" at the boundary (ADR-045).
 */
export function translateClickHouseQueryError(
  error: unknown,
  durationMs: number,
): unknown {
  if (!(error instanceof Error)) return error;

  // `@langwatch/clickhouse`'s client wraps every failure in a
  // `ClickHouseOperationError` carrying the query id and tenant, with the
  // driver's own error on `cause`. The discriminating fields — the numeric
  // `code`, the `type` — live on that cause, not on the wrapper, so a
  // translation that read only the outer error would match nothing and every
  // memory limit and timeout would degrade to "unknown". Unwrapping here
  // rather than at the one call site keeps the same true for anyone else who
  // translates a client error later.
  const unwrapped = unwrapDriverError(error);

  const type = (unwrapped as { type?: string }).type;
  const code = String((unwrapped as { code?: unknown }).code ?? "");
  // The wrapper's own message is prefixed with the client's retry reason and
  // does not contain the server's text, so both are searched: the cause for
  // the real exception name, the wrapper for the case where a caller passed a
  // bare error in.
  const message = `${unwrapped.message}\n${error.message}`;

  if (
    code === "241" ||
    type === "MEMORY_LIMIT_EXCEEDED" ||
    message.includes("MEMORY_LIMIT_EXCEEDED")
  ) {
    return new QueryMemoryExceededError({ reasons: [toError(error)] });
  }

  // 159 is the server-side query-timeout code; a bare /timeout/i match would
  // also catch socket-level timeouts, which are connection problems instead.
  if (
    code === "159" ||
    type === "TIMEOUT_EXCEEDED" ||
    message.includes("TIMEOUT_EXCEEDED")
  ) {
    return new QueryTimeoutError(durationMs, { reasons: [toError(error)] });
  }

  const status =
    (unwrapped as { statusCode?: number }).statusCode ??
    (unwrapped as { status?: number }).status;
  if (TRANSIENT_NETWORK_CODES.has(code) || status === 502 || status === 503) {
    return new ClickHouseUnavailableError({ reasons: [toError(error)] });
  }

  return error;
}

/**
 * The innermost `Error` in a `cause` chain.
 *
 * Walks rather than unwrapping one level, because the chain can be two deep: a
 * repository that catches and rethrows through its own error type sits above
 * the client's wrapper, which sits above the driver's. Bounded so a cyclic
 * `cause` — which nothing here creates, but which a `cause` chain assembled
 * elsewhere could — cannot spin.
 */
function unwrapDriverError(error: Error): Error {
  let current = error;
  for (let depth = 0; depth < 8; depth++) {
    const cause = (current as { cause?: unknown }).cause;
    if (!(cause instanceof Error)) return current;
    current = cause;
  }
  return current;
}
