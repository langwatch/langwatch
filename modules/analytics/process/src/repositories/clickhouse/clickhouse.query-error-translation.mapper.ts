import {
  ClickHouseUnavailableError,
  QueryMemoryExceededError,
  QueryScanLimitExceededError,
  QueryTimeoutError,
} from "@langwatch/analytics-contract";

import { toError } from "./clickhouse.to-error.mapper.ts";

/** Errno codes for connection-level failures (shared with the retry loop). */
export const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

/**
 * One ClickHouse server error, by both forms it can arrive in: `@clickhouse/client`'s
 * `code`/`type` properties, or raw HTTP text's `Code: <n>.` prefix. The message itself is
 * never searched — it echoes the query, so a caller could pick its own code by name.
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

// `max_result_rows` / `max_result_bytes` under `result_overflow_mode = 'throw'` — the
// *output* ceiling, distinct from the read ceilings above. Both settings raise this code.
const TOO_MANY_ROWS_OR_BYTES: ServerError = { code: "396", name: "TOO_MANY_ROWS_OR_BYTES" };

const UNKNOWN_FUNCTION: ServerError = { code: "46", name: "UNKNOWN_FUNCTION" };

// The three server-error shapes are grouped deliberately: the two predicates below split
// "object doesn't exist" (UNKNOWN_TABLE/UNKNOWN_DATABASE) from "grants incomplete"
// (ACCESS_DENIED), matching the two distinct customer-facing errors
// (`LangWatchQLUnavailableError` vs `LangWatchQLProvisioningIncompleteError`).

/**
 * A name in the query that resolves to no column. Kept apart from the three below,
 * which describe the deployment — this one describes the SQL, which only the caller
 * who wrote it can act on.
 */
const UNKNOWN_IDENTIFIER: ServerError = {
  code: "47",
  name: "UNKNOWN_IDENTIFIER",
};

const UNKNOWN_TABLE: ServerError = { code: "60", name: "UNKNOWN_TABLE" };
const UNKNOWN_DATABASE: ServerError = { code: "81", name: "UNKNOWN_DATABASE" };
const ACCESS_DENIED: ServerError = { code: "497", name: "ACCESS_DENIED" };

/**
 * Whether `error` matches any of `variants`, by driver `code`/`type` properties or
 * the anchored `Code: <n>.` prefix. The symbolic name is never searched for in the
 * message — it echoes the query, so a caller could otherwise pick its own error code.
 */
function errorCodeOf(error: object): string {
  const code: unknown = "code" in error ? error.code : void 0;
  return typeof code === "string" || typeof code === "number" ? String(code) : "";
}

function raisedServerError({
  error,
  variants,
}: {
  error: Error;
  variants: readonly ServerError[];
}): boolean {
  const type = (error as { type?: string }).type;
  const code = errorCodeOf(error);
  const messageCode = /^Code:\s*(\d+)/.exec(error.message)?.[1] ?? "";
  return variants.some(
    (variant) =>
      code === variant.code ||
      type === variant.name ||
      (messageCode !== "" && messageCode === variant.code),
  );
}

/**
 * True when the object doesn't exist — UNKNOWN_TABLE (60) or UNKNOWN_DATABASE (81). Not
 * mapped in {@link translateClickHouseQueryError}: a bug on our own connection (ADR-045).
 * Exported for the LangWatchQL executor: means never-provisioned, not access-denied.
 */
export function isClickHouseObjectMissingError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return raisedServerError({
    error,
    variants: [UNKNOWN_TABLE, UNKNOWN_DATABASE],
  });
}

/**
 * True when a name resolves to no column (UNKNOWN_IDENTIFIER, 47). Not mapped in {@link
 * translateClickHouseQueryError} — on our own connection this is a bug (ADR-045); exported
 * for the LangWatchQL executor, where the name is the customer's own.
 */
export function isClickHouseUnknownIdentifierError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return raisedServerError({ error, variants: [UNKNOWN_IDENTIFIER] });
}

/**
 * True when the finished result exceeded `max_result_rows` / `max_result_bytes`
 * (TOO_MANY_ROWS_OR_BYTES, 396). Not mapped in {@link translateClickHouseQueryError}: only the
 * LangWatchQL profile pins those settings, so only its executor can raise it.
 */
export function isClickHouseResultTooLargeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return raisedServerError({ error, variants: [TOO_MANY_ROWS_OR_BYTES] });
}

/**
 * True when the query called a function the server lacks (UNKNOWN_FUNCTION, 46). Not mapped in
 * {@link translateClickHouseQueryError}: on our own connection it is a bug (ADR-045). Exported
 * for the LangWatchQL executor, where it means the projection UDFs are missing.
 */
export function isClickHouseUnknownFunctionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return raisedServerError({ error, variants: [UNKNOWN_FUNCTION] });
}

/**
 * A single identifier, as ClickHouse writes one: a leading letter or
 * underscore, then word characters, optionally qualified by a table alias.
 * Anything else is not something to hand back.
 */
const IDENTIFIER_SHAPE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

/**
 * The sentences ClickHouse uses to say a name resolved to nothing. Both delimiter forms
 * (backtick from the analyzer path, single quote from the older path) are matched without
 * requiring a matched pair — identifiers can't contain either, so that stays safe.
 */
const IDENTIFIER_PATTERNS: readonly RegExp[] = [
  /Unknown (?:expression |table |column )?identifier [`'"]([^`'"]{1,128})[`'"]/,
  /Missing columns: [`'"]([^`'"]{1,128})[`'"]/,
];

/**
 * The identifier ClickHouse could not resolve, or `undefined` on a miss. This is the
 * only thing safely taken from the message — the rest would leak the query and the
 * deployment's shape. Fails closed twice: sentence form, then identifier shape.
 */
export function unknownIdentifierFromError(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  for (const pattern of IDENTIFIER_PATTERNS) {
    const candidate = pattern.exec(error.message)?.[1];
    if (candidate !== undefined && IDENTIFIER_SHAPE.test(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * True when the connecting identity can't read an object the query names — ACCESS_DENIED
 * (497). Distinct from {@link isClickHouseObjectMissingError}: the object exists but our
 * grants are incomplete — our fault, so the customer message must not blame their admin.
 */
export function isClickHouseObjectAccessDeniedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return raisedServerError({ error, variants: [ACCESS_DENIED] });
}

/**
 * Translates a raw ClickHouse driver error into a typed `HandledError`, after retries
 * are exhausted. The raw error is preserved in `reasons` so retry classifiers can still
 * unwrap the transient condition; anything unmapped degrades to "unknown" (ADR-045).
 */
export function translateClickHouseQueryError(error: unknown, durationMs: number): unknown {
  if (!(error instanceof Error)) return error;

  // When no code form is present the matchers simply do not fire and the
  // error degrades to "unknown", which is the documented safe outcome
  // (ADR-045). Matching rules live on `raisedServerError`.
  const raised = (...variants: ServerError[]): boolean => raisedServerError({ error, variants });

  if (raised(MEMORY_LIMIT_EXCEEDED)) {
    return new QueryMemoryExceededError({ reasons: [toError(error)] });
  }

  if (raised(TIMEOUT_EXCEEDED)) {
    return new QueryTimeoutError(durationMs, { reasons: [toError(error)] });
  }

  if (raised(TOO_MANY_ROWS, TOO_MANY_BYTES)) {
    return new QueryScanLimitExceededError({ reasons: [toError(error)] });
  }

  const errno = errorCodeOf(error);
  const status =
    (error as { statusCode?: number }).statusCode ?? (error as { status?: number }).status;
  if (TRANSIENT_NETWORK_CODES.has(errno) || status === 502 || status === 503) {
    return new ClickHouseUnavailableError({ reasons: [toError(error)] });
  }

  return error;
}
