/**
 * Persists the reads a contract marks `persist: true` to IndexedDB, one entry
 * per user, discarded when the build changes. A reload paints from disk and
 * then revalidates. ADR-164; specs/ui/browser-query-caching.feature.
 */

import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { Query, QueryClient } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { del, get, keys, set } from "idb-keyval";

import { PERSISTED_QUERY_MAX_AGE, procedurePathOf, type UiCachePlan } from "./cache-tiers.ts";

const STORE_KEY_PREFIX = "lw-query-cache:";

/** Where persisted reads live: IndexedDB in the browser, a map in a test. */
export type UiQueryStore = {
  getItem(key: string): Promise<string | undefined | null>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<void>;
  keys(): Promise<readonly string[]>;
};

const hasIndexedDb = () => typeof indexedDB !== "undefined";

/** The default store, over idb-keyval's one database; inert where there is none (jsdom, SSR). */
export const indexedDbQueryStore: UiQueryStore = {
  getItem: async (key) => (hasIndexedDb() ? get<string>(key) : void 0),
  setItem: async (key, value) => (hasIndexedDb() ? set(key, value) : void 0),
  removeItem: async (key) => (hasIndexedDb() ? del(key) : void 0),
  keys: async () => (hasIndexedDb() ? (await keys()).filter((key) => typeof key === "string") : []),
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

function storeKeyFor(userId: string): string {
  return `${STORE_KEY_PREFIX}${userId}`;
}

/** Removes every persisted cache but the one named; with none named, removes them all. */
export async function clearPersistedUiQueries({
  store = indexedDbQueryStore,
  keepUserId,
}: {
  store?: UiQueryStore;
  keepUserId?: string;
} = {}): Promise<void> {
  const kept = keepUserId === undefined ? undefined : storeKeyFor(keepUserId);
  const stale = (await store.keys()).filter(
    (key) => key.startsWith(STORE_KEY_PREFIX) && key !== kept,
  );
  await Promise.all(stale.map((key) => store.removeItem(key)));
}

/**
 * Restores this user's persisted reads, then keeps them saved. Another user's
 * cache is removed first, so a switch never paints it. Returns the unsubscribe
 * and the restore, which settles after the restored reads were revalidated.
 */
export function persistUiQueries({
  queryClient,
  plan,
  userId,
  buildId,
  store = indexedDbQueryStore,
}: {
  queryClient: QueryClient;
  plan: UiCachePlan;
  userId: string;
  buildId: string;
  store?: UiQueryStore;
}): { unsubscribe: () => void; restored: Promise<void> } {
  const isPersisted = (query: Query) =>
    plan.persisted.has(procedurePathOf(query.queryKey) ?? "") && query.state.status === "success";

  const [unsubscribe, restoring] = persistQueryClient({
    queryClient,
    persister: createAsyncStoragePersister({ storage: store, key: storeKeyFor(userId) }),
    maxAge: PERSISTED_QUERY_MAX_AGE,
    buster: buildId,
    dehydrateOptions: { shouldDehydrateQuery: isPersisted },
  });

  const restored = clearPersistedUiQueries({ store, keepUserId: userId })
    .then(() => restoring)
    .then(() => queryClient.invalidateQueries({ predicate: isPersisted }));

  return { unsubscribe, restored };
}
