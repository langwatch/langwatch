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
// missing table, missing database, and an RBAC refusal. Grouped because a
// caller cannot tell them apart and must not be able to — which of the three
// fired describes the server's internals, not the query.
/**
 * A name in the query that resolves to no column.
 *
 * Kept apart from the three below: those describe the deployment (a missing
 * view, an ungranted grant), whereas this one describes the SQL, and only a
 * caller who wrote the SQL can act on it.
 */
const UNKNOWN_IDENTIFIER: ServerError = {
  code: "47",
  name: "UNKNOWN_IDENTIFIER",
};

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
 * exist or the connecting identity is not allowed to read it — UNKNOWN_TABLE
 * (60), UNKNOWN_DATABASE (81), ACCESS_DENIED (497).
 *
 * Not mapped inside {@link translateClickHouseQueryError}: on the
 * application's own connection these are plain bugs and must degrade to
 * "unknown" (ADR-045). Exported for the one caller with a stronger invariant —
 * the LangWatchQL executor, whose validator only lets catalog-approved names
 * through, so any of the three there means the deployment's provisioning is
 * incomplete rather than anything about the submitted query.
 */
export function isClickHouseObjectUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return raisedServerError({
    error,
    variants: [UNKNOWN_TABLE, UNKNOWN_DATABASE, ACCESS_DENIED],
  });
}

/**
 * True when the server refused because a name in the query resolves to no
 * column: UNKNOWN_IDENTIFIER (47).
 *
 * Not mapped inside {@link translateClickHouseQueryError}, for the same reason
 * as {@link isClickHouseObjectUnavailableError}: on the application's own
 * connection every column name is one this repository wrote, so a rejected one
 * is a plain bug and must degrade to "unknown" (ADR-045). Exported for the
 * caller where the SQL is the customer's own and the name is theirs to fix,
 * the LangWatchQL executor.
 */
export function isClickHouseUnknownIdentifierError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return raisedServerError({ error, variants: [UNKNOWN_IDENTIFIER] });
}

/**
 * A single identifier, as ClickHouse writes one: a leading letter or
 * underscore, then word characters, optionally qualified by a table alias.
 * Anything else is not something to hand back.
 */
const IDENTIFIER_SHAPE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

/**
 * The sentences ClickHouse uses to say a name resolved to nothing.
 *
 * Captured from a real server rather than assumed. 25.x writes:
 *
 *     Unknown expression identifier `trace_idd_typo` in scope SELECT ...
 *
 * Note the **backticks**: the analyzer quotes identifiers with them, not with
 * the single quotes the rest of its diagnostics use. An earlier version of this
 * matched `'...'` only, passed its own fixtures, and read nothing at all off
 * the live engine, which is what `unknownIdentifier.integration.test.ts`
 * exists to catch. The older non-analyzer path writes `Missing columns: 'x'
 * while processing query: ...` with single quotes, so both delimiters are
 * accepted and the shape check below decides what is usable.
 *
 * Either delimiter opens and closes, rather than a matched pair: an identifier
 * can contain neither, so a mismatched pair cannot smuggle anything past
 * {@link IDENTIFIER_SHAPE}.
 */
const IDENTIFIER_PATTERNS: readonly RegExp[] = [
  /Unknown (?:expression |table |column )?identifier [`'"]([^`'"]{1,128})[`'"]/,
  /Missing columns: [`'"]([^`'"]{1,128})[`'"]/,
];

/**
 * The identifier ClickHouse could not resolve, or `undefined`.
 *
 * **This is the only thing that may be taken from the message.** A ClickHouse
 * error echoes the submitted query and names internal objects, so relaying the
 * text would leak both the query and the deployment's shape to whoever
 * receives the error. So the extraction is deliberately narrow and fails
 * closed twice: the sentence has to match one of the known forms, and the
 * token it captures has to look like an identifier. A miss returns
 * `undefined`, and the caller reports the failure without naming a column,
 * which is worse copy and still correct.
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
