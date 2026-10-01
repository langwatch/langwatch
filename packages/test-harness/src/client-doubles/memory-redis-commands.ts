import type { Redis } from "ioredis";

import type { ClientScript } from "./scripted-client.ts";

/** The keyspace one in-process Redis holds, shared by every connection duplicated from it. */
export type MemoryRedisStore = {
  readonly strings: Map<string, string>;
  readonly expiries: Map<string, number>;
  readonly hashes: Map<string, Map<string, string>>;
  readonly sets: Map<string, Set<string>>;
  readonly sortedSets: Map<string, Map<string, number>>;
  readonly channels: Map<string, Set<Redis>>;
};

export function memoryRedisStore(): MemoryRedisStore {
  return {
    strings: new Map(),
    expiries: new Map(),
    hashes: new Map(),
    sets: new Map(),
    sortedSets: new Map(),
    channels: new Map(),
  };
}

type Batch = Record<string, unknown>;

const DEFAULT_SCAN_COUNT = 10;

const ZADD_FLAGS = ["NX", "XX", "GT", "LT", "CH"];

/** The commands the memory double answers from its store; anything else stays unscripted. */
export function memoryRedisCommands({
  store,
  client,
  self,
  duplicate,
  batch,
}: {
  store: MemoryRedisStore;
  client: Redis;
  self: () => Redis;
  duplicate: () => Redis;
  batch: () => Batch;
}): ClientScript<Redis> {
  return {
    ...connectionCommands({ store, client, self, duplicate, batch }),
    ...stringCommands({ store }),
    ...setCommands({ store }),
    ...sortedSetCommands({ store }),
    ...hashCommands({ store }),
  };
}

function connectionCommands({
  store,
  client,
  self,
  duplicate,
  batch,
}: {
  store: MemoryRedisStore;
  client: Redis;
  self: () => Redis;
  duplicate: () => Redis;
  batch: () => Batch;
}): ClientScript<Redis> {
  return {
    duplicate: () => duplicate(),
    on: (event, listener) => {
      client.on(event, listener);
      return self();
    },
    subscribe: async (...channels: unknown[]) => {
      for (const channel of channels.map(String)) {
        ensure({ map: store.channels, key: channel, create: () => new Set() }).add(client);
      }
      return channels.length;
    },
    unsubscribe: async (...channels: unknown[]) => {
      for (const channel of channels) store.channels.get(String(channel))?.delete(client);
      return 0;
    },
    publish: async (channel: unknown, message: unknown) => {
      const subscribers = [...(store.channels.get(String(channel)) ?? [])];
      for (const subscriber of subscribers) {
        subscriber.emit("message", String(channel), String(message));
      }
      return subscribers.length;
    },
    scan: async (cursor: unknown, ...options: unknown[]) =>
      page({ members: keysOf(store), cursor, options }),
    del: async (...names: unknown[]) =>
      names.flat().filter((key) => deleteKey({ store, key: String(key) })).length,
    expire: async (key: unknown, seconds: unknown) => {
      const name = String(key);
      if (!hasKey({ store, key: name })) return 0;
      store.expiries.set(name, Number(seconds) * 1000);
      return 1;
    },
    ttl: async (key: unknown) => {
      const name = String(key);
      if (!hasKey({ store, key: name })) return -2;
      const ms = store.expiries.get(name);
      return ms === undefined ? -1 : Math.ceil(ms / 1000);
    },
    multi: () => batch(),
    pipeline: () => batch(),
    quit: async () => "OK",
    disconnect: () => undefined,
  };
}

function stringCommands({ store }: { store: MemoryRedisStore }): ClientScript<Redis> {
  const addBy = (key: unknown, delta: number): number => {
    const next = Number(store.strings.get(String(key)) ?? "0") + delta;
    store.strings.set(String(key), String(next));
    return next;
  };
  return {
    get: async (key: unknown) => store.strings.get(String(key)) ?? null,
    set: async (key: unknown, value: unknown, ...options: unknown[]) => {
      const name = String(key);
      const isHeld = store.strings.has(name);
      if (options.includes("NX") && isHeld) return null;
      if (options.includes("XX") && !isHeld) return null;
      store.strings.set(name, String(value));
      store.expiries.delete(name);
      const ttlMs = expiryOf(options);
      if (ttlMs !== undefined) store.expiries.set(name, ttlMs);
      return "OK";
    },
    incr: async (key: unknown) => addBy(key, 1),
    decr: async (key: unknown) => addBy(key, -1),
  };
}

function setCommands({ store }: { store: MemoryRedisStore }): ClientScript<Redis> {
  const membersOf = (key: unknown): string[] => [...(store.sets.get(String(key)) ?? [])];
  return {
    sadd: async (key: unknown, ...members: unknown[]) => {
      const target = ensure({ map: store.sets, key: String(key), create: () => new Set() });
      const before = target.size;
      for (const member of members.flat()) target.add(String(member));
      return target.size - before;
    },
    srem: async (key: unknown, ...members: unknown[]) => {
      const target = store.sets.get(String(key)) ?? new Set();
      const removed = members.flat().filter((member) => target.delete(String(member))).length;
      collect({ store, key: String(key) });
      return removed;
    },
    scard: async (key: unknown) => store.sets.get(String(key))?.size ?? 0,
    smembers: async (key: unknown) => membersOf(key),
    sismember: async (key: unknown, member: unknown) =>
      Number(store.sets.get(String(key))?.has(String(member)) ?? false),
    srandmember: async (key: unknown, count?: unknown) =>
      count === undefined ? (membersOf(key)[0] ?? null) : membersOf(key).slice(0, Number(count)),
    sscan: async (key: unknown, cursor: unknown, ...options: unknown[]) =>
      page({ members: membersOf(key), cursor, options }),
  };
}

function sortedSetCommands({ store }: { store: MemoryRedisStore }): ClientScript<Redis> {
  const ranked = (key: unknown): [string, number][] =>
    [...(store.sortedSets.get(String(key)) ?? [])].toSorted(([, left], [, right]) => left - right);
  return {
    zadd: async (key: unknown, ...args: unknown[]) => {
      const flags = new Set(args.filter((arg) => ZADD_FLAGS.includes(String(arg))).map(String));
      const pairs = args.slice(flags.size);
      const target = ensure({ map: store.sortedSets, key: String(key), create: () => new Map() });
      let added = 0;
      for (let at = 0; at < pairs.length; at += 2) {
        added += addScored({
          target,
          flags,
          score: Number(pairs[at]),
          member: String(pairs[at + 1]),
        });
      }
      collect({ store, key: String(key) });
      return added;
    },
    zrem: async (key: unknown, ...members: unknown[]) => {
      const target = store.sortedSets.get(String(key)) ?? new Map();
      const removed = members.flat().filter((member) => target.delete(String(member))).length;
      collect({ store, key: String(key) });
      return removed;
    },
    zcard: async (key: unknown) => store.sortedSets.get(String(key))?.size ?? 0,
    zrange: async (key: unknown, start: unknown, stop: unknown, ...options: unknown[]) =>
      flatten({ entries: slice({ entries: ranked(key), start, stop }), options }),
    zrevrange: async (key: unknown, start: unknown, stop: unknown, ...options: unknown[]) =>
      flatten({ entries: slice({ entries: ranked(key).reverse(), start, stop }), options }),
    zrangebyscore: async (key: unknown, min: unknown, max: unknown, ...options: unknown[]) =>
      flatten({ entries: ranked(key).filter(([, score]) => within({ score, min, max })), options }),
    zremrangebyscore: async (key: unknown, min: unknown, max: unknown) => {
      const target = store.sortedSets.get(String(key)) ?? new Map<string, number>();
      const doomed = [...target].filter(([, score]) => within({ score, min, max }));
      for (const [member] of doomed) target.delete(member);
      collect({ store, key: String(key) });
      return doomed.length;
    },
    zscan: async (key: unknown, cursor: unknown, ...options: unknown[]) => {
      const entries = ranked(key);
      const [next, members] = page({ members: entries.map(([member]) => member), cursor, options });
      const scores = new Map(entries);
      return [next, members.flatMap((member) => [member, String(scores.get(member))])];
    },
  };
}

function hashCommands({ store }: { store: MemoryRedisStore }): ClientScript<Redis> {
  return {
    hget: async (key: unknown, field: unknown) =>
      store.hashes.get(String(key))?.get(String(field)) ?? null,
    hgetall: async (key: unknown) => Object.fromEntries(store.hashes.get(String(key)) ?? []),
    hset: async (key: unknown, ...args: unknown[]) => {
      const target = ensure({ map: store.hashes, key: String(key), create: () => new Map() });
      const pairs = fieldPairs(args);
      const added = pairs.filter(([field]) => !target.has(field)).length;
      for (const [field, value] of pairs) target.set(field, value);
      return added;
    },
  };
}

function addScored({
  target,
  flags,
  score,
  member,
}: {
  target: Map<string, number>;
  flags: Set<string>;
  score: number;
  member: string;
}): number {
  const current = target.get(member);
  if (current === undefined) {
    if (flags.has("XX")) return 0;
    target.set(member, score);
    return 1;
  }
  if (flags.has("NX")) return 0;
  if (flags.has("LT") && score >= current) return 0;
  if (flags.has("GT") && score <= current) return 0;
  target.set(member, score);
  return 0;
}

function fieldPairs(args: unknown[]): [string, string][] {
  const [first] = args;
  const entries: [unknown, unknown][] =
    typeof first === "object" && first !== null
      ? Object.entries(first)
      : args.flatMap((field, at) => (at % 2 === 0 ? [[field, args[at + 1]]] : []));
  return entries.map(([field, value]) => [String(field), String(value)]);
}

function expiryOf(options: unknown[]): number | undefined {
  const px = options.indexOf("PX");
  if (px >= 0) return Number(options[px + 1]);
  const ex = options.indexOf("EX");
  if (ex >= 0) return Number(options[ex + 1]) * 1000;
  return undefined;
}

function keysOf(store: MemoryRedisStore): string[] {
  const names = [
    ...store.strings.keys(),
    ...store.hashes.keys(),
    ...store.sets.keys(),
    ...store.sortedSets.keys(),
  ];
  return [...new Set(names)].toSorted();
}

function hasKey({ store, key }: { store: MemoryRedisStore; key: string }): boolean {
  return keysOf(store).includes(key);
}

function deleteKey({ store, key }: { store: MemoryRedisStore; key: string }): boolean {
  if (!hasKey({ store, key })) return false;
  for (const map of [store.strings, store.hashes, store.sets, store.sortedSets]) map.delete(key);
  store.expiries.delete(key);
  return true;
}

/** Redis drops a collection when its last member goes. */
function collect({ store, key }: { store: MemoryRedisStore; key: string }): void {
  for (const map of [store.hashes, store.sets, store.sortedSets]) {
    if (map.get(key)?.size === 0) map.delete(key);
  }
}

function ensure<Value>({
  map,
  key,
  create,
}: {
  map: Map<string, Value>;
  key: string;
  create: () => Value;
}): Value {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const created = create();
  map.set(key, created);
  return created;
}

function page({
  members,
  cursor,
  options,
}: {
  members: string[];
  cursor: unknown;
  options: unknown[];
}): [string, string[]] {
  const countAt = options.indexOf("COUNT");
  const count = countAt >= 0 ? Number(options[countAt + 1]) : DEFAULT_SCAN_COUNT;
  const matchAt = options.indexOf("MATCH");
  const pattern = matchAt >= 0 ? globPattern(String(options[matchAt + 1])) : undefined;
  const matching = pattern ? members.filter((member) => pattern.test(member)) : members;
  const offset = Number(cursor);
  const next = offset + count;
  return [next >= matching.length ? "0" : String(next), matching.slice(offset, next)];
}

function globPattern(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
}

function slice({
  entries,
  start,
  stop,
}: {
  entries: [string, number][];
  start: unknown;
  stop: unknown;
}): [string, number][] {
  const from = Number(start) < 0 ? entries.length + Number(start) : Number(start);
  const to = Number(stop) < 0 ? entries.length + Number(stop) : Number(stop);
  return entries.slice(Math.max(from, 0), to + 1);
}

function flatten({
  entries,
  options,
}: {
  entries: [string, number][];
  options: unknown[];
}): string[] {
  const unsupported = options.filter((option) => option !== "WITHSCORES");
  if (unsupported.length > 0) {
    throw new Error(`memory redis does not implement ${unsupported.join(" ")}`);
  }
  const withScores = options.includes("WITHSCORES");
  return entries.flatMap(([member, score]) => (withScores ? [member, String(score)] : [member]));
}

function within({ score, min, max }: { score: number; min: unknown; max: unknown }): boolean {
  return (
    bound({ value: min, compare: (edge) => score > edge, inclusive: (edge) => score >= edge }) &&
    bound({ value: max, compare: (edge) => score < edge, inclusive: (edge) => score <= edge })
  );
}

function bound({
  value,
  compare,
  inclusive,
}: {
  value: unknown;
  compare: (edge: number) => boolean;
  inclusive: (edge: number) => boolean;
}): boolean {
  const text = String(value);
  if (text.startsWith("(")) return compare(edgeOf(text.slice(1)));
  return inclusive(edgeOf(text));
}

function edgeOf(text: string): number {
  if (text === "-inf") return Number.NEGATIVE_INFINITY;
  if (text === "+inf" || text === "inf") return Number.POSITIVE_INFINITY;
  return Number(text);
}
