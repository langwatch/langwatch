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
 *   - a `set`/`delete` that errors or times out is dropped and REPORTED —
 *     one of secondary storage's tenants is the credential sign-in rate
 *     limit, which lives only here, so a dropped write is a rate limit
 *     failing open. That degradation is accepted for the outage window
 *     (D02 Security Concerns) and never silent.
 *
 * Behind `AUTH_REDIS_FAIL_OPEN` — off is exactly today's behavior, which is
 * the rollback (delivery plan PR 3 gate).
 */
import { createLogger } from "@langwatch/observability";
import type { BetterAuthOptions } from "better-auth";
import { Counter, register } from "prom-client";

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

type SecondaryStorage = NonNullable<BetterAuthOptions["secondaryStorage"]>;

class SecondaryStorageTimeoutError extends Error {
  constructor(operation: string) {
    super(
      `secondary storage ${operation} exceeded its ${SECONDARY_STORAGE_TIMEOUT_MS}ms budget`,
    );
    this.name = "SecondaryStorageTimeoutError";
  }
}

function withinBudget<T>(
  operation: string,
  work: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new SecondaryStorageTimeoutError(operation)),
      timeoutMs,
    );
    timer.unref?.();
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error as Error);
      },
    );
  });
}

export function withRedisFailOpen(
  storage: BetterAuthOptions["secondaryStorage"],
  options?: {
    enabled?: boolean;
    timeoutMs?: number;
  },
): BetterAuthOptions["secondaryStorage"] {
  if (!storage) return storage;
  const enabled = options?.enabled ?? true;
  if (!enabled) return storage;
  const timeoutMs = options?.timeoutMs ?? SECONDARY_STORAGE_TIMEOUT_MS;

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
        return await withinBudget(
          "get",
          Promise.resolve(storage.get(key)),
          timeoutMs,
        );
      } catch (error) {
        // A miss, not a failure: better-auth falls through to the database.
        failOpen("get", error);
        return null;
      }
    },
    set: async (key, value, ttl) => {
      try {
        await withinBudget(
          "set",
          Promise.resolve(storage.set(key, value, ttl)),
          timeoutMs,
        );
      } catch (error) {
        failOpen("set", error);
      }
    },
    delete: async (key) => {
      try {
        await withinBudget(
          "delete",
          Promise.resolve(storage.delete(key)),
          timeoutMs,
        );
      } catch (error) {
        failOpen("delete", error);
      }
    },
  };
}
