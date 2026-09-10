/**
 * An in-process stand-in for the `redis` member, for the tests that exercise
 * the connected-agent relay.
 *
 * The relay is a real read of the process's Redis now, so a test that drives
 * it has to supply one. Everything the session-state store calls is here and
 * nothing else is: strings, sorted sets, hashes, counters, the compare-and-set
 * script and pub/sub, all over plain maps shared with every connection
 * `duplicate()` hands out. Time to live is accepted and ignored, because no
 * test outlives an entry.
 */
import type { RedisConnection } from "@langwatch/redis-client";

type Bus = {
  readonly listeners: Map<string, Set<(channel: string, message: string) => void>>;
  readonly subscriptions: Map<string, Set<(channel: string, message: string) => void>>;
};

type Store = {
  readonly strings: Map<string, string>;
  readonly sortedSets: Map<string, Map<string, number>>;
  readonly hashes: Map<string, Map<string, string>>;
};

type QueuedCommand = () => unknown;

function scoreOf(sorted: Map<string, number>, member: string): number | undefined {
  return sorted.get(member);
}

function connection(store: Store, bus: Bus): RedisConnection {
  const own = new Set<(channel: string, message: string) => void>();

  const sortedSet = (key: string): Map<string, number> => {
    const existing = store.sortedSets.get(key);
    if (existing) return existing;
    const created = new Map<string, number>();
    store.sortedSets.set(key, created);
    return created;
  };

  const hash = (key: string): Map<string, string> => {
    const existing = store.hashes.get(key);
    if (existing) return existing;
    const created = new Map<string, string>();
    store.hashes.set(key, created);
    return created;
  };

  const zadd = (key: string, ...args: unknown[]): number => {
    const sorted = sortedSet(key);
    if (args[0] === "XX") {
      const score = Number(args[2]);
      const member = String(args[3]);
      const current = scoreOf(sorted, member);
      if (current === undefined) return 0;
      if (args[1] === "LT" && current <= score) return 0;
      sorted.set(member, score);
      return 0;
    }
    const score = Number(args[0]);
    const member = String(args[1]);
    const added = sorted.has(member) ? 0 : 1;
    sorted.set(member, score);
    return added;
  };

  const hset = (key: string, fields: Record<string, string>): number => {
    const target = hash(key);
    for (const [field, value] of Object.entries(fields)) target.set(field, value);
    return Object.keys(fields).length;
  };

  const incr = (key: string): number => {
    const next = Number(store.strings.get(key) ?? "0") + 1;
    store.strings.set(key, String(next));
    return next;
  };

  const decr = (key: string): number => {
    const next = Number(store.strings.get(key) ?? "0") - 1;
    store.strings.set(key, String(next));
    return next;
  };

  const client = {
    duplicate: () => connection(store, bus),

    on(event: string, handler: (channel: string, message: string) => void) {
      if (event !== "message") return client;
      own.add(handler);
      let listeners = bus.listeners.get("*");
      if (!listeners) {
        listeners = new Set();
        bus.listeners.set("*", listeners);
      }
      listeners.add(handler);
      return client;
    },

    async subscribe(channel: string) {
      let subscribers = bus.subscriptions.get(channel);
      if (!subscribers) {
        subscribers = new Set();
        bus.subscriptions.set(channel, subscribers);
      }
      for (const handler of own) subscribers.add(handler);
      return 1;
    },

    async unsubscribe(channel: string) {
      const subscribers = bus.subscriptions.get(channel);
      for (const handler of own) subscribers?.delete(handler);
      return 0;
    },

    async publish(channel: string, message: string) {
      const subscribers = [...(bus.subscriptions.get(channel) ?? [])];
      for (const handler of subscribers) handler(channel, message);
      return subscribers.length;
    },

    async set(key: string, value: string, ...args: unknown[]) {
      if (args.includes("NX") && store.strings.has(key)) return null;
      store.strings.set(key, value);
      return "OK";
    },

    async eval(_script: string, _keyCount: number, key: string, value: string) {
      const current = store.strings.get(key);
      if (current !== undefined && current !== value) return 0;
      store.strings.set(key, value);
      return 1;
    },

    async get(key: string) {
      return store.strings.get(key) ?? null;
    },

    async del(key: string) {
      const removed =
        Number(store.strings.delete(key)) +
        Number(store.sortedSets.delete(key)) +
        Number(store.hashes.delete(key));
      return removed;
    },

    async expire() {
      return 1;
    },

    async zadd(key: string, ...args: unknown[]) {
      return zadd(key, ...args);
    },

    async zrem(key: string, member: string) {
      return Number(sortedSet(key).delete(member));
    },

    async zremrangebyscore(key: string, _min: string, max: string | number) {
      const ceiling = Number(max);
      const sorted = sortedSet(key);
      let removed = 0;
      for (const [member, score] of [...sorted]) {
        if (score <= ceiling) {
          sorted.delete(member);
          removed += 1;
        }
      }
      return removed;
    },

    async zrangebyscore(key: string, min: string | number) {
      const floor = Number(min);
      return [...sortedSet(key)]
        .filter(([, score]) => score >= floor)
        .sort(([, left], [, right]) => left - right)
        .map(([member]) => member);
    },

    async hgetall(key: string) {
      return Object.fromEntries(hash(key));
    },

    async incr(key: string) {
      return incr(key);
    },

    async decr(key: string) {
      return decr(key);
    },

    multi() {
      const queued: QueuedCommand[] = [];
      const chain = {
        zadd(key: string, ...args: unknown[]) {
          queued.push(() => zadd(key, ...args));
          return chain;
        },
        hset(key: string, fields: Record<string, string>) {
          queued.push(() => hset(key, fields));
          return chain;
        },
        incr(key: string) {
          queued.push(() => incr(key));
          return chain;
        },
        expire() {
          queued.push(() => 1);
          return chain;
        },
        async exec() {
          return queued.map((command) => [null, command()]);
        },
      };
      return chain;
    },

    async quit() {
      return "OK";
    },

    disconnect() {},
  };

  return client as unknown as RedisConnection;
}

/** One in-process Redis, shared by every connection duplicated from it. */
export function memoryRedis(): RedisConnection {
  return connection(
    { strings: new Map(), sortedSets: new Map(), hashes: new Map() },
    { listeners: new Map(), subscriptions: new Map() },
  );
}
