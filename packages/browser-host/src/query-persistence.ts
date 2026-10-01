/**
 * Mirrors `persist: true` reads to IndexedDB, one structured-clone object per query, keyed
 * by user and query hash, discarded by build. ADR-164; specs/ui/browser-query-caching.feature.
 */

import { nowInstant } from "@langwatch/time";
import {
  hashKey,
  type Query,
  type QueryCacheNotifyEvent,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { del, get, keys, set } from "idb-keyval";

import {
  PERSISTED_QUERY_MAX_AGE,
  procedurePathOf,
  type UiCachePlan,
  type UiQueryVersions,
} from "./cache-tiers.ts";

const STORE_KEY_PREFIX = "lw-query:";
const LEGACY_STORE_KEY_PREFIX = "lw-query-cache:";

/** One mirrored read: the data, the version it was answered under (if versioned) and its build. */
export type UiStoredQuery = {
  queryKey: QueryKey;
  data: unknown;
  version?: string;
  updatedAt: number;
  buildId: string;
};

/** Where mirrored reads live: IndexedDB in the browser, a map in a test. */
export type UiQueryStore = {
  get(key: string): Promise<unknown>;
  put(key: string, value: UiStoredQuery): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<readonly string[]>;
};

const hasIndexedDb = () => typeof indexedDB !== "undefined";

/** What a mirrored read must look like to be trusted; anything else is dropped. */
export function isStoredQuery(value: unknown): value is UiStoredQuery {
  if (typeof value !== "object" || value === null) return false;
  if (!("queryKey" in value) || !Array.isArray(value.queryKey)) return false;
  if (!("data" in value) || !("updatedAt" in value) || typeof value.updatedAt !== "number") {
    return false;
  }
  if (!("buildId" in value) || typeof value.buildId !== "string") return false;
  return !("version" in value) || value.version === undefined || typeof value.version === "string";
}

export function storedQueryKey({
  userId,
  queryHash,
}: {
  userId: string;
  queryHash: string;
}): string {
  return `${STORE_KEY_PREFIX}${userId}:${queryHash}`;
}

const memory = new Map<string, unknown>();

/** IndexedDB where it works; otherwise (private mode, SSR, jsdom) this document's memory. */
async function viaIndexedDb<T>({ idb, mem }: { idb: () => Promise<T>; mem: () => T }): Promise<T> {
  if (!hasIndexedDb()) return mem();
  try {
    return await idb();
  } catch {
    return mem();
  }
}

/** The default store, over idb-keyval's one database. */
export const indexedDbQueryStore: UiQueryStore = {
  get: (key) => viaIndexedDb({ idb: () => get<unknown>(key), mem: () => memory.get(key) }),
  put: (key, value) =>
    viaIndexedDb({ idb: () => set(key, value), mem: () => void memory.set(key, value) }),
  delete: async (key) => {
    memory.delete(key);
    await viaIndexedDb({ idb: () => del(key), mem: () => void 0 });
  },
  keys: () =>
    viaIndexedDb({
      idb: async () => (await keys()).filter((key): key is string => typeof key === "string"),
      mem: () => [...memory.keys()],
    }),
};

/**
 * This build's identity: the entry script's address, whose content hash moves
 * whenever anything it imports changes. A dev server's entry never moves;
 * the revalidation after every restore covers it.
 */
export function currentUiBuildId(): string {
  if (typeof document === "undefined") return "unknown";
  return document.querySelector('script[type="module"][src]')?.getAttribute("src") ?? "unknown";
}

/** Removes every mirrored read but the named user's; with none named, removes them all. */
export async function clearPersistedUiQueries({
  store = indexedDbQueryStore,
  keepUserId,
}: {
  store?: UiQueryStore;
  keepUserId?: string;
} = {}): Promise<void> {
  const kept = keepUserId === undefined ? undefined : `${STORE_KEY_PREFIX}${keepUserId}:`;
  const stale = (await store.keys()).filter(
    (key) =>
      key.startsWith(LEGACY_STORE_KEY_PREFIX) ||
      (key.startsWith(STORE_KEY_PREFIX) && !(kept !== undefined && key.startsWith(kept))),
  );
  await Promise.all(stale.map((key) => store.delete(key)));
}

/**
 * One mirrored read, or nothing: an unreadable entry, another build's and an
 * expired one are removed rather than trusted.
 */
export async function readStoredQuery({
  store,
  key,
  buildId,
}: {
  store: UiQueryStore;
  key: string;
  buildId: string;
}): Promise<UiStoredQuery | undefined> {
  const value = await store.get(key).catch(() => void 0);
  if (value === undefined) return;
  const usable =
    isStoredQuery(value) &&
    value.buildId === buildId &&
    nowInstant().epochMilliseconds - value.updatedAt <= PERSISTED_QUERY_MAX_AGE;
  if (usable) return value;
  await store.delete(key).catch(() => void 0);
}

/** Puts one mirrored read in the cache, or removes it when its read is no longer persisted. */
async function restoreStoredQuery({
  entry,
  queryClient,
  plan,
  userId,
  store,
  versions,
  fromDisk,
}: {
  entry: UiStoredQuery;
  queryClient: QueryClient;
  plan: UiCachePlan;
  userId: string;
  store: UiQueryStore;
  versions: UiQueryVersions;
  fromDisk: Set<string>;
}): Promise<void> {
  const hash = hashKey(entry.queryKey);
  if (!plan.persisted.has(procedurePathOf(entry.queryKey) ?? "")) {
    await store.delete(storedQueryKey({ userId, queryHash: hash })).catch(() => void 0);
    return;
  }
  const held = queryClient.getQueryCache().get(hash)?.state.dataUpdatedAt ?? 0;
  if (held >= entry.updatedAt) return;
  fromDisk.add(hash);
  queryClient.setQueryData(entry.queryKey, entry.data, { updatedAt: entry.updatedAt });
  if (entry.version !== undefined) versions.set(hash, entry.version);
}

/** Mirrors a landed fetch of a persisted read; a restore's own write is not mirrored back. */
function mirrorQuery({
  event,
  isPersisted,
  fromDisk,
  versions,
  store,
  userId,
  buildId,
}: {
  event: QueryCacheNotifyEvent;
  isPersisted: (query: Query) => boolean;
  fromDisk: Set<string>;
  versions: UiQueryVersions;
  store: UiQueryStore;
  userId: string;
  buildId: string;
}): void {
  if (event.type !== "updated" || event.action.type !== "success") return;
  const { query } = event;
  if (!isPersisted(query) || fromDisk.delete(query.queryHash)) return;
  const version = versions.get(query.queryHash);
  void store
    .put(storedQueryKey({ userId, queryHash: query.queryHash }), {
      queryKey: query.queryKey,
      data: query.state.data,
      ...(version === undefined ? {} : { version }),
      updatedAt: query.state.dataUpdatedAt,
      buildId,
    })
    .catch(() => void 0);
}

/**
 * Restores this user's mirrored reads, then keeps mirroring them. Another user's are
 * removed first. Returns the unsubscribe and the restore, which settles once the restored
 * reads were revalidated. `versions` is shared with the transport, which sends `since`.
 */
export function persistUiQueries({
  queryClient,
  plan,
  userId,
  buildId,
  store = indexedDbQueryStore,
  versions = new Map<string, string>(),
}: {
  queryClient: QueryClient;
  plan: UiCachePlan;
  userId: string;
  buildId: string;
  store?: UiQueryStore;
  versions?: UiQueryVersions;
}): { unsubscribe: () => void; restored: Promise<void> } {
  const isPersisted = (query: Query) => plan.persisted.has(procedurePathOf(query.queryKey) ?? "");
  const fromDisk = new Set<string>();
  const unsubscribe = queryClient
    .getQueryCache()
    .subscribe((event) =>
      mirrorQuery({ event, isPersisted, fromDisk, versions, store, userId, buildId }),
    );

  const restore = async () => {
    const prefix = storedQueryKey({ userId, queryHash: "" });
    const owned = (await store.keys()).filter((key) => key.startsWith(prefix));
    const entries = await Promise.all(owned.map((key) => readStoredQuery({ store, key, buildId })));
    for (const entry of entries) {
      if (entry) {
        await restoreStoredQuery({ entry, queryClient, plan, userId, store, versions, fromDisk });
      }
    }
  };

  const restored = clearPersistedUiQueries({ store, keepUserId: userId })
    .then(restore)
    .then(() => queryClient.invalidateQueries({ predicate: isPersisted }));

  return { unsubscribe, restored };
}
