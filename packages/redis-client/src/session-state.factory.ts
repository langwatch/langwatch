import { EventEmitter } from "node:events";
import { nowInstant } from "@langwatch/time";
import type { RedisConnection } from "./types.ts";

import type { SessionStateStore } from "./session-state.ts";

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

type Expiring<T> = { value: T; expiresAt: number };

/** The value under a key, or nothing once its expiry passed. */
function live<T>(map: Map<string, Expiring<T>>, key: string, now: () => number): T | null {
  const entry = map.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now()) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

/** The sorted-set half of the memory store. */
function memorySortedSetOps({
  sortedSets,
  now,
}: {
  sortedSets: Map<string, Expiring<Map<string, number>>>;
  now: () => number;
}): Pick<
  SessionStateStore,
  "zadd" | "zaddLowerIfPresent" | "zrem" | "zremrangebyscore" | "zrangebyscore"
> {
  const sortedSet = (key: string, ttlSeconds: number): Map<string, number> => {
    const existing = live(sortedSets, key, now);
    const set = existing ?? new Map<string, number>();
    sortedSets.set(key, { value: set, expiresAt: now() + ttlSeconds * 1000 });
    return set;
  };

  return {
    async zadd({ key, score, member, ttlSeconds }) {
      sortedSet(key, ttlSeconds).set(member, score);
    },
    async zaddLowerIfPresent(key, score, member) {
      const set = live(sortedSets, key, now);
      const current = set?.get(member);
      if (set && current !== void 0 && score < current) {
        set.set(member, score);
      }
    },
    async zrem(key, member) {
      live(sortedSets, key, now)?.delete(member);
    },
    async zremrangebyscore(key, max) {
      const set = live(sortedSets, key, now);
      if (!set) return;
      for (const [member, score] of set) {
        if (score <= max) set.delete(member);
      }
    },
    async zrangebyscore(key, min) {
      const set = live(sortedSets, key, now);
      if (!set) return [];
      return [...set]
        .filter(([, score]) => score >= min)
        .sort(([, left], [, right]) => left - right)
        .map(([member]) => member);
    },
  };
}

/** The hash and counter half of the memory store. */
function memoryHashOps({
  hashes,
  counters,
  now,
}: {
  hashes: Map<string, Expiring<Record<string, string>>>;
  counters: Map<string, Expiring<number>>;
  now: () => number;
}): Pick<SessionStateStore, "hset" | "tryHgetall" | "incr" | "decr"> {
  return {
    async hset(key, fields, ttlSeconds) {
      const current = live(hashes, key, now) ?? {};
      hashes.set(key, {
        value: { ...current, ...fields },
        expiresAt: now() + ttlSeconds * 1000,
      });
    },
    async tryHgetall(key) {
      return live(hashes, key, now);
    },
    async incr(key, ttlSeconds) {
      const next = (live(counters, key, now) ?? 0) + 1;
      counters.set(key, { value: next, expiresAt: now() + ttlSeconds * 1000 });
      return next;
    },
    async decr(key) {
      const entry = counters.get(key);
      if (!entry) return 0;
      const next = Math.max(0, entry.value - 1);
      if (next === 0) counters.delete(key);
      else counters.set(key, { ...entry, value: next });
      return next;
    },
  };
}

/**
 * The in-process stand-in. Expiry is checked on read, so a test can drive
 * the clock through `now` and never waits on a timer.
 */
function createMemoryStateStore({
  now = () => nowInstant().epochMilliseconds,
}: {
  now?: () => number;
} = {}): SessionStateStore {
  const strings = new Map<string, Expiring<string>>();
  const sortedSets = new Map<string, Expiring<Map<string, number>>>();
  const hashes = new Map<string, Expiring<Record<string, string>>>();
  const counters = new Map<string, Expiring<number>>();
  const bus = new EventEmitter();
  bus.setMaxListeners(0);

  return {
    shared: false,
    ...memorySortedSetOps({ sortedSets, now }),
    ...memoryHashOps({ hashes, counters, now }),
    async set(key, value, ttlSeconds) {
      strings.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
    },
    async setIfAbsent(key, value, ttlSeconds) {
      const string = live(strings, key, now);
      const counter = live(counters, key, now);
      if (string !== null || counter !== null) {
        return false;
      }
      strings.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
      return true;
    },
    async tryGet(key) {
      // A counter is a string key in Redis; GET reads it the same way.
      const counter = live(counters, key, now);
      if (counter !== null) return String(counter);
      return live(strings, key, now);
    },
    async setIfAbsentOrEqual(key, value, ttlSeconds) {
      const counter = live(counters, key, now);
      const current = counter === null ? live(strings, key, now) : String(counter);
      if (current !== null && current !== value) {
        return false;
      }
      counters.delete(key);
      strings.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
      return true;
    },
    async del(key) {
      strings.delete(key);
      sortedSets.delete(key);
      hashes.delete(key);
      counters.delete(key);
    },
    async publish(channel, message) {
      const count = bus.listenerCount(channel);
      // Delivered on the next tick, the way a socket would, so a publisher
      // never re-enters its own handler.
      setImmediate(() => bus.emit(channel, message));
      return count;
    },
    async subscribe(channel, handler) {
      bus.on(channel, handler);
      return async () => {
        bus.off(channel, handler);
      };
    },
    async close() {
      bus.removeAllListeners();
      strings.clear();
      sortedSets.clear();
      hashes.clear();
      counters.clear();
    },
  };
}

/**
 * The state store a process holds: Redis when one was installed, process
 * memory otherwise.
 */
export class SessionStateStoreFactory {
  static create(options: { redis?: RedisConnection | null } = {}): SessionStateStore {
    return options.redis
      ? SessionStateStoreFactory.redis(options.redis)
      : SessionStateStoreFactory.memory();
  }

  /** The shared store: every replica reads and writes the same keys. */
  static redis(redis: RedisConnection): SessionStateStore {
    return createRedisStateStore(redis);
  }

  /**
   * The in-process stand-in. Expiry is checked on read, so a test can drive
   * the clock through `now` and never waits on a timer.
   */
  static memory(options: { now?: () => number } = {}): SessionStateStore {
    return createMemoryStateStore(options);
  }

  private constructor() {}
}
