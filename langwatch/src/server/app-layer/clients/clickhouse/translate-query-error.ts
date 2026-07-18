import { toError } from "~/utils/posthogErrorCapture";
import {
  ClickHouseUnavailableError,
  QueryMemoryExceededError,
  QueryTimeoutError,
} from "~/server/app-layer/traces/errors";

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

  const type = (error as { type?: string }).type;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = error.message;

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
    (error as { statusCode?: number }).statusCode ??
    (error as { status?: number }).status;
  if (
    TRANSIENT_NETWORK_CODES.has(code) ||
    status === 502 ||
    status === 503
  ) {
    return new ClickHouseUnavailableError({ reasons: [toError(error)] });
  }

  return error;
}
