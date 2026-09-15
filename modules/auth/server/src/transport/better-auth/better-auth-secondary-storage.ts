import type { BetterAuthOptions } from "better-auth";
import { createLogger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";

type SecondaryStorage = NonNullable<BetterAuthOptions["secondaryStorage"]>;

const logger = createLogger("langwatch:better-auth");

const NAMESPACE = "better-auth:";

// A dropped read is a cache miss better-auth recovers from the database
// (`storeSessionInDatabase: true`). A dropped WRITE has no such recovery, and
// the credential sign-in rate-limit counters live only here: dropping their
// `set` is a rate limit that fails OPEN. The degrade is right; being quiet
// about it is not.

/** Secondary storage for a process that holds no Redis connection. */
export class DroppedBetterAuthSecondaryStorageAdapter {
  /** Writes this process has dropped for want of a connection. */
  private dropped = 0;

  private constructor() {}

  static create(): SecondaryStorage {
    const adapter = new DroppedBetterAuthSecondaryStorageAdapter();
    return {
      get: async () => null,
      getAndDelete: async () => null,
      // Answering "first hit in the window" leaves the limiter open rather
      // than closed: this store is an accelerator, and a deployment that
      // loses it must not lose the ability to sign in.
      increment: async () => {
        adapter.report("increment");
        return 1;
      },
      set: async () => adapter.report("set"),
      delete: async () => adapter.report("delete"),
    };
  }

  // The key is deliberately absent: better-auth keys secondary storage by
  // session token, so the key IS a credential. The running count separates a
  // request that raced boot from a process serving auth without secondary
  // storage all along.
  private report(operation: "set" | "delete" | "increment"): void {
    this.dropped += 1;
    logger.warn(
      { operation, droppedSecondaryWrites: this.dropped },
      "better-auth secondary storage write dropped: the application has no Redis connection. Rate limiting and session revocation degrade to fail-open until it does.",
    );
  }
}

/** Secondary storage over a live connection, namespacing every key. */
export class RedisBetterAuthSecondaryStorageAdapter {
  private constructor() {}

  static create(redis: RedisConnection): SecondaryStorage {
    return {
      get: async (key) => await redis.get(`${NAMESPACE}${key}`),
      // Read-and-clear in one round trip, so two callers racing for a
      // single-use value cannot both be handed it.
      getAndDelete: async (key) => await redis.getdel(`${NAMESPACE}${key}`),
      // The counter behind distributed rate limiting. The TTL is applied only
      // on creation: extending it on every hit would mean a key under
      // sustained traffic never expires, and the limit becomes permanent.
      increment: async (key, ttl) => {
        const namespaced = `${NAMESPACE}${key}`;
        const count = await redis.incr(namespaced);
        if (count === 1) await redis.expire(namespaced, ttl);
        return count;
      },
      set: async (key, value, ttl) => {
        if (ttl) {
          await redis.set(`${NAMESPACE}${key}`, value, "EX", ttl);
        } else {
          await redis.set(`${NAMESPACE}${key}`, value);
        }
      },
      delete: async (key) => {
        await redis.del(`${NAMESPACE}${key}`);
      },
    };
  }
}
