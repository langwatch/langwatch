import type { RedisConnection } from "@langwatch/redis-client";
import type { BetterAuthOptions } from "better-auth";

type SecondaryStorage = NonNullable<BetterAuthOptions["secondaryStorage"]>;

const NAMESPACE = "better-auth:";

const INCREMENT_WITH_EXPIRY = `
local count = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count`;

/** Whole seconds, at least one: `EX` refuses zero and fractions. */
function expirySeconds(ttl: number): number {
  return Math.max(1, Math.ceil(ttl));
}

/** Secondary storage over a live connection, namespacing every key. */
export class RedisBetterAuthSecondaryStorageRepository {
  private constructor() {}

  static create(redis: RedisConnection): SecondaryStorage {
    return {
      get: async (key) => redis.get(`${NAMESPACE}${key}`),
      // Read-and-clear in one round trip, so two callers racing for a
      // single-use value cannot both be handed it.
      getAndDelete: async (key) => redis.getdel(`${NAMESPACE}${key}`),
      // The counter behind distributed rate limiting, counted and expired in one script: an
      // INCR then a separate EXPIRE can leave a counter with no TTL, a lockout that never
      // lifts. The TTL is set only on a counter without one, so traffic never extends it.
      increment: async (key, ttl) =>
        Number(
          await redis.eval(INCREMENT_WITH_EXPIRY, 1, `${NAMESPACE}${key}`, expirySeconds(ttl)),
        ),
      // A value with no time left is deleted, never written bare: Redis runs noeviction.
      set: async (key, value, ttl) => {
        if (ttl && ttl > 0) {
          await redis.set(`${NAMESPACE}${key}`, value, "EX", expirySeconds(ttl));
        } else {
          await redis.del(`${NAMESPACE}${key}`);
        }
      },
      delete: async (key) => {
        await redis.del(`${NAMESPACE}${key}`);
      },
    };
  }
}
