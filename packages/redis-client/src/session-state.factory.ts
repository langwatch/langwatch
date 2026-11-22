import type { SessionStateStore } from "./session-state.ts";
import type { RedisConnection } from "./types.ts";

/**
 * The channel half of the Redis store, with the handlers by channel.
 */
function createRedisChannels(
  redis: RedisConnection,
): Pick<SessionStateStore, "subscribe" | "close"> {
  let subscriber: RedisConnection | null = null;
  const handlers = new Map<string, Set<(message: string) => void>>();
  const subscribing = new Map<string, Promise<void>>();

  const subscriberConnection = (): RedisConnection => {
    if (subscriber) return subscriber;
    subscriber = redis.duplicate();
    subscriber.on("message", (channel: string, message: string) => {
      for (const handler of handlers.get(channel) ?? []) handler(message);
    });
    return subscriber;
  };

  return {
    async subscribe(channel, handler) {
      const connection = subscriberConnection();
      let set = handlers.get(channel);
      if (!set) {
        set = new Set();
        handlers.set(channel, set);
        // Redis delivers from the moment SUBSCRIBE is acknowledged, so the
        // command is started here and the handler is registered before it is
        // awaited. A failed SUBSCRIBE drops the channel again, so the next
        // caller starts a fresh one.
        subscribing.set(
          channel,
          connection.subscribe(channel).then(
            () => {
              subscribing.delete(channel);
            },
            (error: unknown) => {
              subscribing.delete(channel);
              handlers.delete(channel);
              throw error;
            },
          ),
        );
      }
      set.add(handler);
      // A second caller for the same channel waits for the first SUBSCRIBE
      // rather than returning while it is still in flight.
      await subscribing.get(channel);
      return async () => {
        const current = handlers.get(channel);
        current?.delete(handler);
        if (current && current.size === 0) {
          handlers.delete(channel);
          await connection.unsubscribe(channel).catch(() => void 0);
        }
      };
    },
    async close() {
      handlers.clear();
      subscribing.clear();
      if (subscriber) {
        const closing = subscriber;
        subscriber = null;
        await closing.quit().catch(() => void 0);
      }
    },
  };
}

function createRedisStateStore(redis: RedisConnection): SessionStateStore {
  const channels = createRedisChannels(redis);

  return {
    shared: true,
    async set(key, value, ttlSeconds) {
      await redis.set(key, value, "EX", ttlSeconds);
    },
    async setIfAbsent(key, value, ttlSeconds) {
      const written = await redis.set(key, value, "EX", ttlSeconds, "NX");
      return written === "OK";
    },
    async setIfAbsentOrEqual(key, value, ttlSeconds) {
      const claimed = await redis.eval(
        `local current = redis.call('GET', KEYS[1])
         if current and current ~= ARGV[1] then return 0 end
         redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
         return 1`,
        1,
        key,
        value,
        ttlSeconds,
      );
      return claimed === 1;
    },
    async tryGet(key) {
      return redis.get(key);
    },
    async del(key) {
      await redis.del(key);
    },
    async zadd({ key, score, member, ttlSeconds }) {
      await redis.multi().zadd(key, score, member).expire(key, ttlSeconds).exec();
    },
    async zaddLowerIfPresent(key, score, member) {
      await redis.zadd(key, "XX", "LT", score, member);
    },
    async zrem(key, member) {
      await redis.zrem(key, member);
    },
    async zremrangebyscore(key, max) {
      await redis.zremrangebyscore(key, "-inf", max);
    },
    async zrangebyscore(key, min) {
      return redis.zrangebyscore(key, min, "+inf");
    },
    async hset(key, fields, ttlSeconds) {
      await redis.multi().hset(key, fields).expire(key, ttlSeconds).exec();
    },
    async tryHgetall(key) {
      const fields = await redis.hgetall(key);
      return Object.keys(fields).length > 0 ? fields : null;
    },
    async incr(key, ttlSeconds) {
      const [incremented] = (await redis.multi().incr(key).expire(key, ttlSeconds).exec()) ?? [];
      // A transaction resolves with one [error, result] tuple per command.
      // A failed INCR leaves the result empty, and a count read as zero would
      // hand out concurrency slots the instance does not have.
      if (incremented?.[0]) throw incremented[0];
      return Number(incremented?.[1] ?? 0);
    },
    async decr(key) {
      const value = await redis.decr(key);
      if (value <= 0) await redis.del(key);
      return Math.max(0, value);
    },
    async publish(channel, message) {
      return redis.publish(channel, message);
    },
    subscribe: channels.subscribe,
    close: channels.close,
  };
}

/** The Redis session-state store; its memory twin is `memorySessionState` in process-stores. */
export class SessionStateStoreFactory {
  /** The shared store: every replica reads and writes the same keys. */
  static redis(redis: RedisConnection): SessionStateStore {
    return createRedisStateStore(redis);
  }

  private constructor() {}
}
