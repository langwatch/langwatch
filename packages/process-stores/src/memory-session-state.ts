import { EventEmitter } from "node:events";

import type { SessionStateStore } from "@langwatch/redis-client/session-state";
import { nowInstant } from "@langwatch/time";

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
        .toSorted(([, left], [, right]) => left - right)
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
 * The in-process session-state store. Expiry is checked on read, so a test
 * can drive the clock through `now` and never waits on a timer.
 */
export function memorySessionState({
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
