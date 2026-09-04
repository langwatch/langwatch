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
 * arrives as raw HTTP text carries neither, and is read from the `Code: <n>.`
 * prefix the engine writes at the head of the body. Both are needed — reading
 * only the message would miss the driver's own errors, whose text it has
 * already stripped.
 *
 * The message is not searched for the symbolic name: it echoes the submitted
 * query, so that would let a caller name a table after a variant and pick the
 * error code it gets back.
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

// The three shapes of "the object this query names is not there for you":
// missing table, missing database, and an RBAC refusal. None of the three is
// ever echoed back to the caller — the LangWatchQL validator only lets
// catalog-approved names reach the database, so which one fired describes the
// server's internals (and this deployment's provisioning), never the query —
// but the two callers below intentionally group them differently: the first
// pair means the objects the catalog promises are not there at all, the third
// means they exist but this identity's grants are incomplete. That is a real
// difference for the customer-facing message (see
// `LangWatchQLUnavailableError` vs `LangWatchQLProvisioningIncompleteError`),
// so it must not be a difference the two predicates below erase.
const UNKNOWN_TABLE: ServerError = { code: "60", name: "UNKNOWN_TABLE" };
const UNKNOWN_DATABASE: ServerError = { code: "81", name: "UNKNOWN_DATABASE" };
const ACCESS_DENIED: ServerError = { code: "497", name: "ACCESS_DENIED" };

/**
 * Whether `error` is one of `variants`, by any of the three forms a server
 * error arrives in: the driver's `code` property, its `type` property, or the
 * `Code: <n>.` prefix the engine writes at the head of a raw HTTP body.
 *
 * The prefix is anchored, and the symbolic name is never searched for in the
 * message: the message echoes the submitted query, so a table or alias named
 * after a variant would otherwise let the caller choose its own error.
 */
function raisedServerError({
  error,
  variants,
}: {
  error: Error;
  variants: readonly ServerError[];
}): boolean {
  const type = (error as { type?: string }).type;
  const code = String((error as { code?: unknown }).code ?? "");
  const messageCode = /^Code:\s*(\d+)/.exec(error.message)?.[1] ?? "";
  return variants.some(
    (variant) =>
      code === variant.code ||
      type === variant.name ||
      (messageCode !== "" && messageCode === variant.code),
  );
}

/**
 * True when the server refused because an object the query names does not
 * exist for this identity at all — UNKNOWN_TABLE (60), UNKNOWN_DATABASE (81).
 *
 * Not mapped inside {@link translateClickHouseQueryError}: on the
 * application's own connection these are plain bugs and must degrade to
 * "unknown" (ADR-045). Exported for the one caller with a stronger invariant —
 * the LangWatchQL executor, whose validator only lets catalog-approved names
 * through, so either of these there means the deployment never provisioned
 * the object at all, distinct from {@link isClickHouseObjectAccessDeniedError}.
 */
export function isClickHouseObjectMissingError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return raisedServerError({
    error,
    variants: [UNKNOWN_TABLE, UNKNOWN_DATABASE],
  });
}

/**
 * True when the server refused because the connecting identity is not
 * allowed to read an object the query names — ACCESS_DENIED (497).
 *
 * Kept apart from {@link isClickHouseObjectMissingError}: on the LangWatchQL
 * executor's stronger invariant (validator-approved names only), this means
 * the object exists and the catalog is otherwise working, but this
 * identity's grants on it are incomplete — a narrower, purely-our-fault
 * condition than "nothing is provisioned," and one whose customer-facing
 * message must not send a customer to their own workspace administrator for
 * something only we can fix.
 */
export function isClickHouseObjectAccessDeniedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return raisedServerError({ error, variants: [ACCESS_DENIED] });
}

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

  // When no code form is present the matchers simply do not fire and the
  // error degrades to "unknown", which is the documented safe outcome
  // (ADR-045). Matching rules live on `raisedServerError`.
  const raised = (...variants: ServerError[]): boolean =>
    raisedServerError({ error, variants });

  if (raised(MEMORY_LIMIT_EXCEEDED)) {
    return new QueryMemoryExceededError({ reasons: [toError(error)] });
  }

  if (raised(TIMEOUT_EXCEEDED)) {
    return new QueryTimeoutError(durationMs, { reasons: [toError(error)] });
  }

  if (raised(TOO_MANY_ROWS, TOO_MANY_BYTES)) {
    return new QueryScanLimitExceededError({ reasons: [toError(error)] });
  }

  const errno = String((error as { code?: unknown }).code ?? "");
  const status =
    (error as { statusCode?: number }).statusCode ??
    (error as { status?: number }).status;
  if (TRANSIENT_NETWORK_CODES.has(errno) || status === 502 || status === 503) {
    return new ClickHouseUnavailableError({ reasons: [toError(error)] });
  }

  return error;
}
