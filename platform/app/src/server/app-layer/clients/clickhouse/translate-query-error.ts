import {
  ClickHouseUnavailableError,
  QueryMemoryExceededError,
  QueryScanLimitExceededError,
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
 * One ClickHouse server error, by both of the forms it can arrive in.
 *
 * `@clickhouse/client` sets `code` and `type` as properties; an error that
 * arrives as raw HTTP text carries neither, so the symbolic name has to be
 * matched in the message as well. Both are needed — matching only the message
 * would miss the driver's own errors, whose text it has already stripped.
 */
interface ServerError {
  /** The numeric code, as a string — how the driver exposes it. */
  readonly code: string;
  /** The symbolic name, which is both the `type` property and a message token. */
  readonly name: string;
}

const MEMORY_LIMIT_EXCEEDED: ServerError = {
  code: "241",
  name: "MEMORY_LIMIT_EXCEEDED",
};

/**
 * The server-side query-timeout code. Matched by name rather than a bare
 * /timeout/i, which would also catch socket-level timeouts — those are
 * connection problems and belong to `ClickHouseUnavailableError`.
 */
const TIMEOUT_EXCEEDED: ServerError = {
  code: "159",
  name: "TIMEOUT_EXCEEDED",
};

// Measured against 25.10.2.65: `max_rows_to_read` raises 158 and
// `max_bytes_to_read` raises 307, both only because `read_overflow_mode =
// 'throw'` refuses to hand back a partial result.
const TOO_MANY_ROWS: ServerError = { code: "158", name: "TOO_MANY_ROWS" };
const TOO_MANY_BYTES: ServerError = { code: "307", name: "TOO_MANY_BYTES" };

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
 * - TOO_MANY_ROWS (158) / TOO_MANY_BYTES (307) → `QueryScanLimitExceededError` —
 *   a scan ceiling (`max_rows_to_read` / `max_bytes_to_read`) under
 *   `read_overflow_mode = 'throw'`, which the governed analytics profile pins.
 *   Same remediation shape, different cause from memory.
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
  const raised = (...variants: ServerError[]): boolean =>
    variants.some(
      (variant) =>
        code === variant.code ||
        type === variant.name ||
        message.includes(variant.name),
    );

  if (raised(MEMORY_LIMIT_EXCEEDED)) {
    return new QueryMemoryExceededError({ reasons: [toError(error)] });
  }

  if (raised(TIMEOUT_EXCEEDED)) {
    return new QueryTimeoutError(durationMs, { reasons: [toError(error)] });
  }

  if (raised(TOO_MANY_ROWS, TOO_MANY_BYTES)) {
    return new QueryScanLimitExceededError({ reasons: [toError(error)] });
  }

  const status =
    (error as { statusCode?: number }).statusCode ??
    (error as { status?: number }).status;
  if (TRANSIENT_NETWORK_CODES.has(code) || status === 502 || status === 503) {
    return new ClickHouseUnavailableError({ reasons: [toError(error)] });
  }

  return error;
}
