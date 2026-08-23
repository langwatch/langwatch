/**
 * D02 seam (b) — better-auth's Redis secondary storage, made down-tolerant.
 *
 * The base storage (index.ts) is already NULL-tolerant: no connection means
 * reads miss to the database and writes drop with a warn. What it is not is
 * DOWN-tolerant — a Redis that is configured but erroring, or worse hanging,
 * holds every sign-in request on an `await` with no bound. This wrapper puts
 * a budget on every call and fails OPEN:
 *
 *   - a `get` that errors or times out answers null — a cache miss, which
 *     better-auth recovers from Postgres (sessions dual-write there,
 *     `storeSessionInDatabase`, ADR-049's "a Redis outage cannot erase a
 *     committed Postgres projection").
 *   - a `set` that errors or times out is dropped and REPORTED — one of
 *     secondary storage's tenants is the credential sign-in rate limit,
 *     which lives only here, so a dropped write is a rate limit failing
 *     open. That degradation is accepted for the outage window (D02
 *     Security Concerns) and never silent.
 *   - a `delete` that errors or times out fails open the same way, but is
 *     also RETRIED out of band: a dropped delete is a revoked session Redis
 *     keeps serving until its TTL, so the key goes into a bounded retry set
 *     and the underlying delete is re-attempted on an interval until it
 *     lands, the retry window closes, or the set overflows — abandonment is
 *     counted and warned, recovery logged.
 *
 * Behind `AUTH_REDIS_FAIL_OPEN` — off is exactly today's behavior, which is
 * the rollback (the D02 exit gate, dev/docs/identity-platform/delivery-plan.md).
 */
import { createLogger } from "@langwatch/observability";
import type { BetterAuthOptions } from "better-auth";
import { Counter, register } from "prom-client";
import { withinBudget } from "~/server/app-layer/_shared/within-budget";

const logger = createLogger("langwatch:better-auth:secondary-storage");

/**
 * The budget for one secondary-storage round trip. Generous against a
 * healthy Redis (sub-millisecond) and tight against a hung one: the worst a
 * dead Redis can add to a sign-in request is this bound, once per storage
 * call on the path. Recorded in ADR-007's Redis-loss amendment.
 */
export const SECONDARY_STORAGE_TIMEOUT_MS = 500;

const METRIC_NAME = "betterauth_secondary_storage_fail_open_total";
register.removeSingleMetric(METRIC_NAME);

/**
 * Every secondary-storage call that failed open — errored or overran its
 * budget — by operation. Expected to move only while Redis is down; a
 * climbing `set` count is rate limiting failing open fleet-wide.
 */
export const betterAuthSecondaryStorageFailOpenTotal = new Counter({
  name: METRIC_NAME,
  help: "better-auth secondary storage calls that failed open to Postgres-only behavior (Redis configured but erroring or over budget).",
  labelNames: ["operation"] as const,
});

/** How often the out-of-band pass re-attempts dropped deletes. */
export const DELETE_RETRY_INTERVAL_MS = 30_000;

/**
 * How long a dropped delete keeps retrying before it is abandoned. Bounded
 * because the underlying key carries its own Redis TTL — past this window
 * the retry is racing an expiry that will win anyway, and an unbounded set
 * is a leak during a long outage.
 */
export const DELETE_RETRY_WINDOW_MS = 15 * 60_000;

/** Hard cap on keys awaiting retry; overflow abandons the oldest. */
export const DELETE_RETRY_MAX_KEYS = 1_000;

class SecondaryStorageTimeoutError extends Error {
  constructor(operation: string) {
    super(
      `secondary storage ${operation} exceeded its ${SECONDARY_STORAGE_TIMEOUT_MS}ms budget`,
    );
    this.name = "SecondaryStorageTimeoutError";
  }
}

/**
 * The out-of-band retry behind a dropped `delete`. One queue per wrapped
 * storage. The timer starts lazily on the first failure, is unref()'d so it
 * never holds a short-lived process (or a test) open, and stops the moment
 * the set empties. Keys are never logged — they are session tokens.
 */
function createDeleteRetryQueue({
  deleteKey,
  maxKeys = DELETE_RETRY_MAX_KEYS,
}: {
  deleteKey: (key: string) => Promise<unknown>;
  maxKeys?: number;
}): { enqueue: (key: string) => void } {
  const pendingSince = new Map<string, number>();
  let timer: NodeJS.Timeout | undefined;
  // A pass over a full queue of hanging deletes can outlast the interval;
  // without this guard the timer stacks passes onto the Redis that is
  // already down, multiplying concurrent calls per pending key.
  let isPassRunning = false;

  const abandon = (key: string, reason: "window_elapsed" | "overflow") => {
    pendingSince.delete(key);
    betterAuthSecondaryStorageFailOpenTotal.inc({
      operation: "delete_retry_abandoned",
    });
    logger.warn(
      { reason },
      "better-auth secondary storage abandoned a dropped delete after retrying; the key stays servable from Redis until its own TTL",
    );
  };

  const stopTimerWhenIdle = () => {
    if (pendingSince.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  const retryOne = async (
    key: string,
    firstFailedAtMs: number,
    now: number,
  ) => {
    if (now - firstFailedAtMs > DELETE_RETRY_WINDOW_MS) {
      abandon(key, "window_elapsed");
      return;
    }
    try {
      await deleteKey(key);
    } catch {
      // Still down; the key stays pending until its window closes.
      return;
    }
    pendingSince.delete(key);
    logger.info(
      "better-auth secondary storage recovered a dropped delete on retry",
    );
  };

  const retryPass = async () => {
    if (isPassRunning) return;
    isPassRunning = true;
    try {
      const now = Date.now();
      for (const [key, firstFailedAtMs] of pendingSince) {
        await retryOne(key, firstFailedAtMs, now);
      }
      stopTimerWhenIdle();
    } finally {
      isPassRunning = false;
    }
  };

  const startTimerIfStopped = () => {
    if (timer !== undefined) return;
    timer = setInterval(() => void retryPass(), DELETE_RETRY_INTERVAL_MS);
    timer.unref?.();
  };

  const abandonOldestWhenFull = () => {
    if (pendingSince.size < maxKeys) return;
    const oldestKey: string | undefined = pendingSince.keys().next().value;
    if (oldestKey !== undefined) abandon(oldestKey, "overflow");
  };

  return {
    enqueue: (key: string) => {
      if (!pendingSince.has(key)) {
        abandonOldestWhenFull();
        pendingSince.set(key, Date.now());
      }
      startTimerIfStopped();
    },
  };
}

export function withRedisFailOpen(
  storage: BetterAuthOptions["secondaryStorage"],
  options?: {
    enabled?: boolean;
    timeoutMs?: number;
    /** Retry-set cap override; tests shrink it to reach the overflow path. */
    deleteRetryMaxKeys?: number;
  },
): BetterAuthOptions["secondaryStorage"] {
  if (!storage) return storage;
  const enabled = options?.enabled ?? true;
  if (!enabled) return storage;
  const timeoutMs = options?.timeoutMs ?? SECONDARY_STORAGE_TIMEOUT_MS;

  const deleteWithinBudget = (key: string) =>
    withinBudget({
      work: Promise.resolve(storage.delete(key)),
      timeoutMs,
      onTimeout: () => new SecondaryStorageTimeoutError("delete"),
    });
  const deleteRetries = createDeleteRetryQueue({
    deleteKey: deleteWithinBudget,
    maxKeys: options?.deleteRetryMaxKeys,
  });

  const failOpen = (operation: "get" | "set" | "delete", error: unknown) => {
    betterAuthSecondaryStorageFailOpenTotal.inc({ operation });
    // The key is deliberately not logged — better-auth keys secondary
    // storage by session token, so the key IS a credential.
    logger.warn(
      { operation, error },
      "better-auth secondary storage failed open: Redis is configured but erroring or over budget. Sessions run Postgres-only; rate limiting and session revocation degrade to fail-open until it recovers.",
    );
  };

  return {
    get: async (key) => {
      try {
        return await withinBudget({
          work: Promise.resolve(storage.get(key)),
          timeoutMs,
          onTimeout: () => new SecondaryStorageTimeoutError("get"),
        });
      } catch (error) {
        // A miss, not a failure: better-auth falls through to the database.
        failOpen("get", error);
        return null;
      }
    },
    set: async (key, value, ttl) => {
      try {
        await withinBudget({
          work: Promise.resolve(storage.set(key, value, ttl)),
          timeoutMs,
          onTimeout: () => new SecondaryStorageTimeoutError("set"),
        });
      } catch (error) {
        failOpen("set", error);
      }
    },
    delete: async (key) => {
      try {
        await deleteWithinBudget(key);
      } catch (error) {
        // A dropped delete is a revoked session Redis keeps serving, so it
        // is retried out of band rather than only counted.
        failOpen("delete", error);
        deleteRetries.enqueue(key);
      }
    },
  };
}
