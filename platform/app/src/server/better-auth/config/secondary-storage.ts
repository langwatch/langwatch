import { createLogger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";
import type { BetterAuthOptions } from "better-auth";

const logger = createLogger("langwatch:better-auth");

export interface SecondaryStorageDeps {
  /**
   * Whether this deployment gives better-auth a Redis-backed store at all.
   *
   * Decided from configuration rather than from a live client (ADR-093), and
   * decided at module load, because `betterAuth()` is constructed at module
   * load and the choice changes its session strategy — a deployment with no
   * Redis must get `undefined` and keep its sessions in the database.
   */
  configured: boolean;
  /**
   * The application's connection at the moment a callback runs.
   *
   * Null wherever env advertises Redis but the App has none, which is three
   * states, not one: a test app, a callback firing before boot completes, and —
   * for the whole life of the process — anything that never builds an App at
   * all (a task, a bare `tsx scripts/*.ts`). `start.ts` boots before it
   * listens, so the web entrypoint only ever sees the first two.
   *
   * Resolving per call rather than once at import is what makes this possible,
   * and it is deliberate: the alternative needs a live client at module load.
   */
  connection: () => RedisConnection | null;
}

/**
 * better-auth's secondary storage over the App's Redis connection. Used by
 * rate limiting so limits are enforced across pods, and by the session cache.
 *
 * Every callback is an instance field rather than a method, so the object
 * better-auth holds carries its own `this` however it is passed around, and
 * the dropped-write counter below is one number per storage rather than one
 * per process (ADR-129 rule 5).
 */
export class RedisSecondaryStorage {
  /**
   * How many writes this process has dropped for want of a connection.
   *
   * Carried in the log line because the *first* drop and the ten-thousandth
   * mean different things: one is a request that raced boot, a climbing count
   * is a process serving auth with no secondary storage at all.
   */
  private droppedSecondaryWrites = 0;

  constructor(
    private readonly deps: Pick<SecondaryStorageDeps, "connection">,
  ) {}

  get = async (key: string): Promise<string | null> => {
    const redis = this.deps.connection();
    // A miss, not a failure: better-auth falls through to the database.
    if (!redis) return null;
    return await redis.get(`better-auth:${key}`);
  };

  // Read-and-clear in one round trip, so two callers racing for a
  // single-use value cannot both be handed it. `GETDEL` is what the
  // rest of the app already uses for exactly this (the scenario tab
  // registry, the GitHub install nonce).
  getAndDelete = async (key: string): Promise<string | null> => {
    const redis = this.deps.connection();
    if (!redis) return null;
    return await redis.getdel(`better-auth:${key}`);
  };

  // The counter behind distributed rate limiting. Required by
  // better-auth 1.7 — before it, the limiter read and wrote a serialized
  // record, which two pods could interleave.
  //
  // The TTL is applied ONLY on creation, which is the whole shape of a
  // fixed window: extending it on every hit would mean a key under
  // sustained traffic never expires, and the limit becomes permanent
  // rather than per-window.
  increment = async (key: string, ttl: number): Promise<number> => {
    const redis = this.deps.connection();
    // No Redis, no counter. Answering "first hit in the window" leaves
    // the limiter open rather than closed, which is the same call every
    // other callback here makes: this store is an accelerator, and a
    // deployment that loses it must not lose the ability to sign in.
    if (!redis) {
      this.reportDroppedWrite("increment");
      return 1;
    }
    const namespaced = `better-auth:${key}`;
    const count = await redis.incr(namespaced);
    if (count === 1) await redis.expire(namespaced, ttl);
    return count;
  };

  set = async (key: string, value: string, ttl?: number): Promise<void> => {
    const redis = this.deps.connection();
    if (!redis) return this.reportDroppedWrite("set");
    if (ttl) {
      await redis.set(`better-auth:${key}`, value, "EX", ttl);
    } else {
      await redis.set(`better-auth:${key}`, value);
    }
  };

  delete = async (key: string): Promise<void> => {
    const redis = this.deps.connection();
    if (!redis) return this.reportDroppedWrite("delete");
    await redis.del(`better-auth:${key}`);
  };

  /**
   * Reports a write that went nowhere.
   *
   * A dropped read is a cache miss and better-auth recovers it from the
   * database. A dropped WRITE has no such recovery, and one of its tenants is
   * the credential sign-in rate-limit counter, which lives only in secondary
   * storage: dropping the `set` is a rate limit that fails OPEN. That is a
   * security-relevant degradation, so it does not get to be silent (#6950).
   *
   * The key is deliberately not logged. Better-auth keys secondary storage by
   * session token, so the key IS a credential.
   */
  private reportDroppedWrite(operation: "set" | "delete" | "increment"): void {
    this.droppedSecondaryWrites += 1;
    logger.warn(
      { operation, droppedSecondaryWrites: this.droppedSecondaryWrites },
      "better-auth secondary storage write dropped: Redis is configured but the application has no connection. Rate limiting and session revocation degrade to fail-open until it does.",
    );
  }
}

/**
 * The storage better-auth is configured with — `undefined` when this
 * deployment has no Redis, in which case sessions stay in the database.
 */
export function secondaryStorage(
  deps: SecondaryStorageDeps,
): BetterAuthOptions["secondaryStorage"] {
  return deps.configured ? new RedisSecondaryStorage(deps) : undefined;
}
