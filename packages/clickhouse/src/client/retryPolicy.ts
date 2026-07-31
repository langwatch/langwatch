/**
 * Only inserts are retried. A select and a DDL statement are re-issued by
 * whoever called them or not at all (ADR-104 §3, amended) — see
 * {@link evaluateDuplicateSafety} for why a read's retry costs more than it
 * buys, and why a repeated `CREATE`/`ALTER` is not a thing this client may
 * decide to do on its own.
 *
 * Within inserts, retry safety is a property of the write target, never of the
 * error (ADR-104 §2-3). A socket timeout looks identical from the caller's side
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
 * Whether this operation may be re-issued at all.
 *
 * For an insert this is a duplicate-safety question, and the answer is the
 * ADR-099 / ADR-104 table verbatim: `replacing` collapses duplicates at merge;
 * `append` collapses only when its sort key already carries a per-record
 * identity; `aggregating` never does.
 *
 * For a select it is not a duplicate question at all — a repeated read
 * corrupts nothing — and the client still refuses, because the cost of the
 * retry is paid by everyone else. Only inserts are retried (ADR-104 §3,
 * amended). A read that failed on transport has already consumed its slice of
 * a pool that defaults to 10 and a per-tenant bulkhead below that; re-issuing
 * it holds that slot for up to three more request timeouts while the very
 * condition that broke the connection is still in force, which is how a
 * ClickHouse blip becomes a queue of reads long enough to outlive it. A read
 * also always has a caller waiting on it — an HTTP request, a UI panel — and
 * that caller is the right place to decide whether a stale answer, a narrower
 * query or a visible failure beats another 30 seconds of waiting. An insert
 * has no such caller: its retry is the only thing standing between a transient
 * blip and lost data, which is why it keeps one.
 */
function evaluateDuplicateSafety(
  operation: Operation,
): { readonly safe: true } | { readonly safe: false; readonly reason: string } {
  switch (operation.kind) {
    case "select":
      return {
        safe: false,
        reason:
          "selects are never retried: a read has a caller waiting and holds a pooled connection the rest of the process needs",
      };
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

  // Structural refusals are evaluated before the error is classified, so the
  // reason a select or a DDL gives back names the real ground — "selects are
  // never retried" — rather than whichever property the failure happened to
  // have. For an operation that is never retried, the error is irrelevant.
  const safety = evaluateDuplicateSafety(operation);
  if (!safety.safe) {
    return { retry: false, reason: safety.reason };
  }

  if (!isTransientTransportError(error)) {
    return {
      retry: false,
      reason:
        "not a transient transport failure — retrying would reproduce a deterministic server-side outcome",
    };
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
