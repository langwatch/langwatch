/**
 * Retry safety is a property of the write target, never of the error
 * (ADR-104 §2-3). A socket timeout looks identical from the caller's side
 * whether the block landed on the server or not — what differs is the
 * consequence, and the consequence is entirely a function of what the
 * destination table does with two rows sharing a key. Keying the decision on
 * the error message instead is how the client this package replaces ended up
 * retrying `AggregatingMergeTree` inserts, quadrupling the double count on
 * every transient blip.
 *
 * `defineTable`'s `merge` strategy (ADR-099) is that property. This module
 * takes it as `WriteTarget` rather than importing `defineTable` itself,
 * because the retry decision only needs the one field, and importing the
 * schema module here would give a pure decision function a dependency on the
 * table-definition machinery for no benefit.
 */

/**
 * The merge strategy of the table an insert targets, mirroring `defineTable`'s
 * `merge` discriminant (ADR-099). Only the fields the retry decision actually
 * reads are carried across — not the full table definition.
 */
export type WriteTarget =
  | { readonly kind: "replacing" }
  | { readonly kind: "append"; readonly perRecordIdentity: boolean }
  | { readonly kind: "aggregating" };

export type Operation =
  | { readonly kind: "select" }
  | { readonly kind: "insert"; readonly target: WriteTarget }
  | { readonly kind: "ddl" };

export type RetryDecision =
  | { readonly retry: true; readonly afterMs: number; readonly attempt: number }
  | { readonly retry: false; readonly reason: string };

/**
 * Errno codes for a request that never reached a working server. Deliberately
 * excludes ClickHouse's own numeric exception codes (as strings, e.g. `"241"`
 * for `MEMORY_LIMIT_EXCEEDED`, `"159"` for `TIMEOUT_EXCEEDED`) — those are
 * server-side outcomes that will reproduce identically on retry, not
 * transport failures. `ETIMEDOUT` is included because a socket-level connect
 * timeout is a transport-class failure distinct from CH's own
 * `TIMEOUT_EXCEEDED`, which never surfaces as this errno.
 */
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET", // includes Node's "socket hang up"
  "ECONNREFUSED",
  "ENOTFOUND", // DNS
  "EAI_AGAIN", // DNS, transient resolver failure
  "EPIPE",
  "ETIMEDOUT",
]);

const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);

/**
 * True only for failures that mean "this request did not reach a working
 * server" — connection reset, socket hang-up, refused connection, DNS
 * failure, broken pipe, or a gateway/proxy error in front of the endpoint.
 *
 * False for everything else, including `MEMORY_LIMIT_EXCEEDED`,
 * `TIMEOUT_EXCEEDED`, and any other query-level exception: those describe a
 * request that *did* reach ClickHouse and got a deterministic answer, so
 * retrying reproduces the same failure while holding a connection from a pool
 * that defaults to 10 (ADR-104 §3).
 */
export function isTransientTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const code = String((error as NodeJS.ErrnoException).code ?? "");
  if (TRANSIENT_NETWORK_CODES.has(code)) return true;

  const status =
    (error as { statusCode?: number }).statusCode ??
    (error as { status?: number }).status;
  if (typeof status === "number" && TRANSIENT_HTTP_STATUSES.has(status)) {
    return true;
  }

  return false;
}

/**
 * Whether a duplicate delivery of this operation is safe to make, independent
 * of whether the failure that prompted the retry was transient. This is the
 * ADR-099 / ADR-104 table verbatim: `replacing` collapses duplicates at
 * merge; `append` collapses only when its sort key already carries a
 * per-record identity; `aggregating` and DDL never do.
 */
function evaluateDuplicateSafety(
  operation: Operation,
): { readonly safe: true } | { readonly safe: false; readonly reason: string } {
  switch (operation.kind) {
    case "select":
      return { safe: true };
    case "ddl":
      return {
        safe: false,
        reason:
          "DDL is never retried: it is not a write to a row, and a repeated CREATE/ALTER is not idempotent",
      };
    case "insert":
      switch (operation.target.kind) {
        case "replacing":
          return { safe: true };
        case "append":
          return operation.target.perRecordIdentity
            ? { safe: true }
            : {
                safe: false,
                reason:
                  "append without a per-record identity duplicates rows permanently on retry",
              };
        case "aggregating":
          return {
            safe: false,
            reason:
              "aggregating merges add on retry — a duplicate silently corrupts the aggregate",
          };
      }
  }
}

const DEFAULT_MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 200;
const MAX_DELAY_MS = 10_000;

/**
 * Full-jitter exponential backoff (AWS's formulation:
 * `random_between(0, min(cap, base * 2^attempt))`). Jitter is not an
 * optimisation here, it is a correctness requirement for a shared,
 * un-clustered-by-default backend (ADR-104 §2): every worker that failed on
 * the same ClickHouse blip would otherwise retry in lockstep on the next
 * exponential tick, reproducing the exact spike that caused the first
 * failure.
 */
function fullJitterBackoff({
  attempt,
  baseDelayMs,
  maxDelayMs,
}: {
  attempt: number;
  baseDelayMs: number;
  maxDelayMs: number;
}): number {
  const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.random() * cap;
}

/**
 * Decides whether a failed ClickHouse operation may be retried, and after how
 * long.
 *
 * `attempt` is the number of attempts already made — `1` after the first
 * attempt has failed. The returned decision's own `attempt` is the number to
 * pass back in on the next call.
 *
 * Never depends on server-side dedup (`insert_deduplication_token`,
 * `non_replicated_deduplication_window`): some deployments are not
 * clustered, `ReplicatedReplacingMergeTree` only replaces the plain engine
 * when a cluster name is configured (ADR-104 §2), and the `aggregating`
 * tables are non-replicated literals everywhere. The decision here is
 * structural — it holds with or without any of that being present.
 */
export function decideRetry(args: {
  operation: Operation;
  error: unknown;
  attempt: number;
  maxAttempts?: number;
}): RetryDecision {
  const {
    operation,
    error,
    attempt,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
  } = args;

  if (!isTransientTransportError(error)) {
    return {
      retry: false,
      reason:
        "not a transient transport failure — retrying would reproduce a deterministic server-side outcome",
    };
  }

  const safety = evaluateDuplicateSafety(operation);
  if (!safety.safe) {
    return { retry: false, reason: safety.reason };
  }

  if (attempt >= maxAttempts) {
    return {
      retry: false,
      reason: `retry budget exhausted after ${maxAttempts} attempts`,
    };
  }

  return {
    retry: true,
    afterMs: fullJitterBackoff({
      attempt,
      baseDelayMs: BASE_DELAY_MS,
      maxDelayMs: MAX_DELAY_MS,
    }),
    attempt: attempt + 1,
  };
}
