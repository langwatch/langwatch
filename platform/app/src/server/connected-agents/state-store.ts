/**
 * The small key, sorted-set, hash and pub/sub surface connected agents need,
 * over Redis or over process memory.
 *
 * One interface, two implementations, so the registry, the dispatcher and the
 * gateway are written once. The memory store stands in when Redis is not
 * configured; it is correct only with one app replica, and the gateway
 * refuses connections otherwise. Redis is obtained through the app layer by
 * the caller (ADR-093), never from a module singleton here.
 */

import { EventEmitter } from "node:events";
import type { RedisConnection } from "@langwatch/redis-client";

export type Unsubscribe = () => Promise<void>;

export interface AgentStateStore {
  /** Whether this store is shared between app replicas. */
  readonly shared: boolean;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** SET NX: writes only when the key is absent; resolves to whether it wrote. */
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
  zadd(
    key: string,
    score: number,
    member: string,
    ttlSeconds: number,
  ): Promise<void>;
  /** ZADD XX LT: lowers the score of a present member, never raises it. */
  zaddLowerIfPresent(key: string, score: number, member: string): Promise<void>;
  zrem(key: string, member: string): Promise<void>;
  zremrangebyscore(key: string, max: number): Promise<void>;
  /** Members with a score at or above `min`, in score order. */
  zrangebyscore(key: string, min: number): Promise<string[]>;
  hset(
    key: string,
    fields: Record<string, string>,
    ttlSeconds: number,
  ): Promise<void>;
  hgetall(key: string): Promise<Record<string, string> | null>;
  incr(key: string, ttlSeconds: number): Promise<number>;
  decr(key: string): Promise<number>;
  /** Publishes; resolves to how many subscribers received it. */
  publish(channel: string, message: string): Promise<number>;
  subscribe(
    channel: string,
    handler: (message: string) => void,
  ): Promise<Unsubscribe>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Redis
// ---------------------------------------------------------------------------

export function createRedisStateStore(redis: RedisConnection): AgentStateStore {
  // One subscriber connection per store; ioredis puts a subscribing
  // connection into subscriber mode, so it cannot share the command one.
  let subscriber: RedisConnection | null = null;
  const handlers = new Map<string, Set<(message: string) => void>>();

  const subscriberConnection = (): RedisConnection => {
    if (subscriber) return subscriber;
    subscriber = (redis as { duplicate(): RedisConnection }).duplicate();
    subscriber.on("message", (channel: string, message: string) => {
      for (const handler of handlers.get(channel) ?? []) handler(message);
    });
    return subscriber;
  };

  return {
    shared: true,
    async set(key, value, ttlSeconds) {
      await redis.set(key, value, "EX", ttlSeconds);
    },
    async setIfAbsent(key, value, ttlSeconds) {
      const written = await redis.set(key, value, "EX", ttlSeconds, "NX");
      return written === "OK";
    },
    async get(key) {
      return redis.get(key);
    },
    async del(key) {
      await redis.del(key);
    },
    async zadd(key, score, member, ttlSeconds) {
      await redis
        .multi()
        .zadd(key, score, member)
        .expire(key, ttlSeconds)
        .exec();
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
    async hgetall(key) {
      const fields = await redis.hgetall(key);
      return Object.keys(fields).length > 0 ? fields : null;
    },
    async incr(key, ttlSeconds) {
      const [incremented] =
        (await redis.multi().incr(key).expire(key, ttlSeconds).exec()) ?? [];
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
    async subscribe(channel, handler) {
      const connection = subscriberConnection();
      let set = handlers.get(channel);
      if (!set) {
        set = new Set();
        handlers.set(channel, set);
        await connection.subscribe(channel);
      }
      set.add(handler);
      return async () => {
        const current = handlers.get(channel);
        current?.delete(handler);
        if (current && current.size === 0) {
          handlers.delete(channel);
          await connection.unsubscribe(channel).catch(() => undefined);
        }
      };
    },
    async close() {
      handlers.clear();
      if (subscriber) {
        const closing = subscriber;
        subscriber = null;
        await closing.quit().catch(() => undefined);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

type Expiring<T> = { value: T; expiresAt: number };

/**
 * The in-process stand-in. Expiry is checked on read, so a test can drive
 * the clock through `now` and never waits on a timer.
 */
export function createMemoryStateStore({
  now = () => Date.now(),
}: {
  now?: () => number;
} = {}): AgentStateStore {
  const strings = new Map<string, Expiring<string>>();
  const sortedSets = new Map<string, Expiring<Map<string, number>>>();
  const hashes = new Map<string, Expiring<Record<string, string>>>();
  const counters = new Map<string, Expiring<number>>();
  const bus = new EventEmitter();
  bus.setMaxListeners(0);

  function live<T>(map: Map<string, Expiring<T>>, key: string): T | null {
    const entry = map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      map.delete(key);
      return null;
    }
    return entry.value;
  }

  const sortedSet = (key: string, ttlSeconds: number): Map<string, number> => {
    const existing = live(sortedSets, key);
    const set = existing ?? new Map<string, number>();
    sortedSets.set(key, { value: set, expiresAt: now() + ttlSeconds * 1000 });
    return set;
  };

  return {
    shared: false,
    async set(key, value, ttlSeconds) {
      strings.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
    },
    async setIfAbsent(key, value, ttlSeconds) {
      if (live(strings, key) !== null || live(counters, key) !== null) {
        return false;
      }
      strings.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
      return true;
    },
    async get(key) {
      // A counter is a string key in Redis; GET reads it the same way.
      const counter = live(counters, key);
      if (counter !== null) return String(counter);
      return live(strings, key);
    },
    async del(key) {
      strings.delete(key);
      sortedSets.delete(key);
      hashes.delete(key);
      counters.delete(key);
    },
    async zadd(key, score, member, ttlSeconds) {
      sortedSet(key, ttlSeconds).set(member, score);
    },
    async zaddLowerIfPresent(key, score, member) {
      const set = live(sortedSets, key);
      const current = set?.get(member);
      if (set && current !== undefined && score < current) {
        set.set(member, score);
      }
    },
    async zrem(key, member) {
      live(sortedSets, key)?.delete(member);
    },
    async zremrangebyscore(key, max) {
      const set = live(sortedSets, key);
      if (!set) return;
      for (const [member, score] of set) {
        if (score <= max) set.delete(member);
      }
    },
    async zrangebyscore(key, min) {
      const set = live(sortedSets, key);
      if (!set) return [];
      return [...set]
        .filter(([, score]) => score >= min)
        .sort(([, left], [, right]) => left - right)
        .map(([member]) => member);
    },
    async hset(key, fields, ttlSeconds) {
      const current = live(hashes, key) ?? {};
      hashes.set(key, {
        value: { ...current, ...fields },
        expiresAt: now() + ttlSeconds * 1000,
      });
    },
    async hgetall(key) {
      return live(hashes, key);
    },
    async incr(key, ttlSeconds) {
      const next = (live(counters, key) ?? 0) + 1;
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
