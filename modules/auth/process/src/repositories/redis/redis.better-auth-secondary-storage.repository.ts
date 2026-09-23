import type { RedisConnection } from "@langwatch/redis-client";
import type { BetterAuthOptions } from "better-auth";

type SecondaryStorage = NonNullable<BetterAuthOptions["secondaryStorage"]>;

const NAMESPACE = "better-auth:";

/** Secondary storage over a live connection, namespacing every key. */
export class RedisBetterAuthSecondaryStorageRepository {
  private constructor() {}

  static create(redis: RedisConnection): SecondaryStorage {
    return {
      get: async (key) => redis.get(`${NAMESPACE}${key}`),
      // Read-and-clear in one round trip, so two callers racing for a
      // single-use value cannot both be handed it.
      getAndDelete: async (key) => redis.getdel(`${NAMESPACE}${key}`),
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
