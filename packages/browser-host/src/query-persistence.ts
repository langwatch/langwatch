/**
 * Mirrors every read the cache plan keeps to IndexedDB, one AES-GCM sealed object per query under
 * the session's key, keyed by user and query hash, dropped when its read's schema hash moves.
 * ARCHITECTURE.md §10.2; specs/ui/browser-query-caching.feature.
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

import { procedurePathOf, type UiCachePlan, type UiQueryVersions } from "./cache-tiers.ts";
import { isForbiddenAnswer } from "./session-version.ts";

const STORE_KEY_PREFIX = "lw-query:";
const LEGACY_STORE_KEY_PREFIX = "lw-query-cache:";

/** One mirrored read: the data, the version it was answered under (if any) and its schema hash. */
export type UiStoredQuery = {
  queryKey: QueryKey;
  data: unknown;
  version?: string;
  updatedAt: number;
  schemaHash: string;
};

/** Where mirrored reads live: IndexedDB in the browser, a map in a test; `Row` is what it holds. */
export type UiQueryStore<Row = UiStoredQuery> = {
  get(key: string): Promise<unknown>;
  put(key: string, value: Row): Promise<void>;
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
  if (!("schemaHash" in value) || typeof value.schemaHash !== "string") return false;
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

/** The default disk, over idb-keyval's one database; only ever written through a sealed store. */
export const indexedDbQueryStore: UiQueryStore<unknown> = {
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

/** Removes every mirrored read but the named user's; with none named, removes them all. */
export async function clearPersistedUiQueries({
  store = indexedDbQueryStore,
  keepUserId,
}: {
  store?: UiQueryStore<unknown>;
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

const SEAL_ALGORITHM = "AES-GCM";
const SEAL_IV_BYTES = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** One epoch's key for this session, imported non-extractable and held in memory only. */
type UiQueryCipher = Readonly<{ subtle: SubtleCrypto; key: CryptoKey }>;

/** A mirrored read on disk: the whole row sealed, its size and when it was last read. */
type UiSealedQuery = Readonly<{
  iv: Uint8Array<ArrayBuffer>;
  sealed: Uint8Array<ArrayBuffer>;
  bytes?: number;
  readAt?: number;
}>;

/** What one user's mirror may hold on this device; a row over `maxRowBytes` is never written. */
export const UI_QUERY_MIRROR_BUDGET: UiQueryMirrorBudget = {
  maxBytes: 25 * 1024 * 1024,
  maxRows: 500,
  maxRowBytes: 2 * 1024 * 1024,
};
export type UiQueryMirrorBudget = Readonly<{
  maxBytes: number;
  maxRows: number;
  maxRowBytes: number;
}>;

/** A row's last read is written back to disk at most this often. */
const READ_AT_FLUSH_MS = 60_000;

/** A sealed store; a touched row is read, so the last to be evicted. */
export type UiSealedQueryStore = UiQueryStore & { touch(key: string): void };

/** One row as this document knows it, without reading the disk again. */
type UiMirrorEntry = { bytes: number; readAt: number; flushedReadAt: number };

/** Paths already reported as too large to mirror, once each per document. */
const oversizedPaths = new Set<string>();

function mirrorEntryOf(value: unknown): UiMirrorEntry | undefined {
  if (!isSealedQuery(value)) return;
  const readAt = value.readAt ?? 0;
  return { bytes: value.sealed.byteLength, readAt, flushedReadAt: readAt };
}

function reportOversized({ key, value, bytes }: { key: string; value: unknown; bytes: number }) {
  const path = (isStoredQuery(value) ? procedurePathOf(value.queryKey) : void 0) ?? key;
  if (oversizedPaths.has(path)) return;
  oversizedPaths.add(path);
  console.debug("A read too large to mirror stays in memory only", { path, bytes });
}

function isSealedQuery(value: unknown): value is UiSealedQuery {
  if (typeof value !== "object" || value === null) return false;
  if (!("iv" in value) || !ArrayBuffer.isView(value.iv)) return false;
  if ("readAt" in value && typeof value.readAt !== "number") return false;
  return "sealed" in value && ArrayBuffer.isView(value.sealed);
}

/** Undefined where WebCrypto is not (an insecure context): nothing is then mirrored. */
async function importUiQueryCipher({
  cacheKey,
}: {
  cacheKey: string;
}): Promise<UiQueryCipher | undefined> {
  try {
    const { subtle } = crypto;
    const raw = Uint8Array.from(atob(cacheKey), (char) => char.charCodeAt(0));
    const key = await subtle.importKey("raw", raw, SEAL_ALGORITHM, false, ["encrypt", "decrypt"]);
    return { subtle, key };
  } catch {
    return;
  }
}

/** The row, or undefined for one sealed under another key, tampered with or not sealed at all. */
async function openSealedQuery({
  cipher,
  key,
  value,
}: {
  cipher: UiQueryCipher | undefined;
  key: string;
  value: unknown;
}): Promise<unknown> {
  if (!cipher || !isSealedQuery(value)) return;
  try {
    const opened = await cipher.subtle.decrypt(
      { name: SEAL_ALGORITHM, iv: value.iv, additionalData: encoder.encode(key) },
      cipher.key,
      value.sealed,
    );
    const row: unknown = JSON.parse(decoder.decode(opened));
    return row;
  } catch {
    return;
  }
}

/** The row sealed under `cipher` with a fresh IV, bound to its key. */
async function sealQuery({
  cipher,
  key,
  plain,
}: {
  cipher: UiQueryCipher;
  key: string;
  plain: Uint8Array<ArrayBuffer>;
}): Promise<Pick<UiSealedQuery, "iv" | "sealed">> {
  const iv = crypto.getRandomValues(new Uint8Array(SEAL_IV_BYTES));
  const sealed = await cipher.subtle.encrypt(
    { name: SEAL_ALGORITHM, iv, additionalData: encoder.encode(key) },
    cipher.key,
    plain,
  );
  return { iv, sealed: new Uint8Array(sealed) };
}

/** What every stage of one sealed store reads; `manifest` is this user's rows as seen here. */
type SealContext = {
  store: UiQueryStore<unknown>;
  current: Promise<UiQueryCipher | undefined>;
  previous: Promise<UiQueryCipher | undefined>;
  budget: UiQueryMirrorBudget;
  now: () => number;
  manifest: Map<string, UiMirrorEntry>;
  unflushed: Set<string>;
  flushTimer: ReturnType<typeof setTimeout> | undefined;
};

async function removeRow({ context, key }: { context: SealContext; key: string }) {
  context.manifest.delete(key);
  context.unflushed.delete(key);
  await context.store.delete(key);
}

/** Removes the least recently read rows until the mirror is back within its budget. */
async function evictToBudget(context: SealContext): Promise<void> {
  const { manifest, budget } = context;
  let bytes = [...manifest.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  const coldestFirst = [...manifest].toSorted(([, a], [, b]) => a.readAt - b.readAt);
  for (const [key, entry] of coldestFirst) {
    if (manifest.size <= budget.maxRows && bytes <= budget.maxBytes) return;
    bytes -= entry.bytes;
    await removeRow({ context, key });
  }
}

/** Seals and writes one row under this epoch's key; one too large is removed, not written. */
async function sealRow({
  context,
  key,
  value,
  readAt,
}: {
  context: SealContext;
  key: string;
  value: unknown;
  readAt: number;
}): Promise<void> {
  const cipher = await context.current;
  if (!cipher) return;
  const plain = encoder.encode(JSON.stringify(value));
  if (plain.byteLength > context.budget.maxRowBytes) {
    reportOversized({ key, value, bytes: plain.byteLength });
    await removeRow({ context, key });
    return;
  }
  const sealed = await sealQuery({ cipher, key, plain });
  const bytes = sealed.sealed.byteLength;
  await context.store.put(key, { ...sealed, bytes, readAt });
  context.manifest.set(key, { bytes, readAt, flushedReadAt: readAt });
  await evictToBudget(context);
}

/** A row only last epoch's key opens is re-sealed under this one, in the background. */
async function openWithPrevious({
  context,
  key,
  value,
  entry,
}: {
  context: SealContext;
  key: string;
  value: unknown;
  entry: UiMirrorEntry;
}): Promise<unknown> {
  const aged = await openSealedQuery({ cipher: await context.previous, key, value });
  if (aged === undefined) {
    await removeRow({ context, key });
    return;
  }
  void sealRow({ context, key, value: aged, readAt: entry.readAt }).catch(() => void 0);
  return aged;
}

/** One row opened under this epoch's key, else last epoch's, else removed as a miss. */
async function openRow({ context, key }: { context: SealContext; key: string }): Promise<unknown> {
  const value = await context.store.get(key);
  if (value === undefined) return;
  const entry = mirrorEntryOf(value);
  if (!entry) {
    await removeRow({ context, key });
    return;
  }
  const row = await openSealedQuery({ cipher: await context.current, key, value });
  if (row === undefined) return openWithPrevious({ context, key, value, entry });
  context.manifest.set(key, entry);
  return row;
}

/** Last reads reach the disk in one batch. */
async function flushReadAt(context: SealContext): Promise<void> {
  context.flushTimer = void 0;
  const keys = [...context.unflushed];
  context.unflushed.clear();
  for (const key of keys) {
    const entry = context.manifest.get(key);
    const value = await context.store.get(key);
    if (!entry || !isSealedQuery(value)) continue;
    await context.store.put(key, { ...value, readAt: entry.readAt });
    entry.flushedReadAt = entry.readAt;
  }
}

/** Marks a row read now; it reaches the disk at most once a minute. */
function touchReadAt({ context, key }: { context: SealContext; key: string }): void {
  const entry = context.manifest.get(key);
  if (!entry) return;
  entry.readAt = context.now();
  if (entry.readAt - entry.flushedReadAt < READ_AT_FLUSH_MS) return;
  context.unflushed.add(key);
  context.flushTimer ??= setTimeout(() => void flushReadAt(context).catch(() => void 0), 1_000);
}

/**
 * Every mirrored read goes through this: written under this epoch's key; read under it, else
 * last epoch's and re-sealed in the background; else a miss, removed. Over budget, the least
 * recently read rows go first. tRPC data crossed the wire as JSON, so JSON is lossless here.
 */
export function sealedUiQueryStore({
  store,
  cacheKey,
  previousCacheKey,
  budget = UI_QUERY_MIRROR_BUDGET,
  now = () => nowInstant().epochMilliseconds,
}: {
  store: UiQueryStore<unknown>;
  cacheKey: string;
  previousCacheKey: string | undefined;
  budget?: UiQueryMirrorBudget;
  now?: () => number;
}): UiSealedQueryStore {
  const context: SealContext = {
    store,
    current: importUiQueryCipher({ cacheKey }),
    previous: previousCacheKey
      ? importUiQueryCipher({ cacheKey: previousCacheKey })
      : Promise.resolve(void 0),
    budget,
    now,
    manifest: new Map(),
    unflushed: new Set(),
    flushTimer: void 0,
  };
  return {
    get: (key) => openRow({ context, key }),
    put: (key, value) => sealRow({ context, key, value, readAt: now() }),
    delete: (key) => removeRow({ context, key }),
    keys: () => store.keys(),
    touch: (key) => touchReadAt({ context, key }),
  };
}

/** Per cache, the original fetch time of each read restored from disk. */
const restoredAtByCache = new WeakMap<QueryClient, Map<string, number>>();

function restoredAtOf(queryClient: QueryClient): Map<string, number> {
  const held = restoredAtByCache.get(queryClient);
  if (held) return held;
  const restoredAt = new Map<string, number>();
  restoredAtByCache.set(queryClient, restoredAt);
  return restoredAt;
}

/** Whether the read still holds the copy drawn from disk: no answer has landed since. */
export function isRestoredFromDisk({
  queryClient,
  query,
}: {
  queryClient: QueryClient;
  query: Query;
}): boolean {
  return restoredAtByCache.get(queryClient)?.get(query.queryHash) === query.state.dataUpdatedAt;
}

/**
 * One mirrored read, or nothing: an unreadable entry, and one stored under a schema hash the
 * plan no longer gives its read, are removed rather than trusted. No build id or age decides it.
 */
export async function readStoredQuery({
  store,
  key,
  plan,
}: {
  store: UiQueryStore;
  key: string;
  plan: UiCachePlan;
}): Promise<UiStoredQuery | undefined> {
  const value = await store.get(key).catch(() => void 0);
  if (value === undefined) return;
  const usable =
    isStoredQuery(value) &&
    value.schemaHash === plan.schemaHashFor(procedurePathOf(value.queryKey) ?? "");
  if (usable) return value;
  await store.delete(key).catch(() => void 0);
}

/** Puts one mirrored read in the cache unless a newer copy is already held. */
function restoreStoredQuery({
  entry,
  queryClient,
  versions,
  restoredAt,
}: {
  entry: UiStoredQuery;
  queryClient: QueryClient;
  versions: UiQueryVersions;
  restoredAt: Map<string, number>;
}): void {
  const hash = hashKey(entry.queryKey);
  const held = queryClient.getQueryCache().get(hash)?.state.dataUpdatedAt ?? 0;
  if (held >= entry.updatedAt) return;
  restoredAt.set(hash, entry.updatedAt);
  queryClient.setQueryData(entry.queryKey, entry.data, { updatedAt: entry.updatedAt });
  if (entry.version !== undefined) versions.set(hash, entry.version);
}

/**
 * Mirrors a landed fetch of a persisted read and touches a read one; a restored copy stays put.
 * An answer the server stamped with another schema hash than this bundle's (an older tab) drops
 * the row instead of storing new data under the old hash.
 */
function mirrorQuery({
  event,
  isPersisted,
  plan,
  servedSchemaHashFor,
  restoredAt,
  versions,
  store,
  userId,
}: {
  event: QueryCacheNotifyEvent;
  isPersisted: (query: Query) => boolean;
  plan: UiCachePlan;
  servedSchemaHashFor: (path: string) => string | undefined;
  restoredAt: Map<string, number>;
  versions: UiQueryVersions;
  store: UiSealedQueryStore;
  userId: string;
}): void {
  const { query } = event;
  if (!isPersisted(query)) return;
  if (event.type === "observerAdded") {
    store.touch(storedQueryKey({ userId, queryHash: query.queryHash }));
    return;
  }
  if (event.type === "updated" && event.action.type === "error") {
    if (isForbiddenAnswer(event.action.error)) {
      void store.delete(storedQueryKey({ userId, queryHash: query.queryHash })).catch(() => void 0);
    }
    return;
  }
  if (event.type !== "updated" || event.action.type !== "success") return;
  if (restoredAt.get(query.queryHash) === query.state.dataUpdatedAt) return;
  const path = procedurePathOf(query.queryKey) ?? "";
  const schemaHash = plan.schemaHashFor(path);
  if (schemaHash === undefined) return;
  const served = servedSchemaHashFor(path);
  if (served !== undefined && served !== schemaHash) {
    void store.delete(storedQueryKey({ userId, queryHash: query.queryHash })).catch(() => void 0);
    return;
  }
  const version = versions.get(query.queryHash);
  void store
    .put(storedQueryKey({ userId, queryHash: query.queryHash }), {
      queryKey: query.queryKey,
      data: query.state.data,
      ...(version === undefined ? {} : { version }),
      updatedAt: query.state.dataUpdatedAt,
      schemaHash,
    })
    .catch(() => void 0);
}

/**
 * Restores this user's mirrored reads, then keeps mirroring them. Another user's are removed
 * first, and the session read never mirrors. Returns the unsubscribe and the restore, which settles
 * once the restored reads were revalidated. `versions` is shared with the tab sync.
 */
export function persistUiQueries({
  queryClient,
  plan,
  userId,
  store,
  sessionQueryKey,
  versions = new Map<string, string>(),
  servedSchemaHashFor = () => void 0,
}: {
  queryClient: QueryClient;
  plan: UiCachePlan;
  userId: string;
  /** A sealed store (`sealedUiQueryStore`); the raw disk is never written directly. */
  store: UiSealedQueryStore;
  /** The session read, which carries the key, and so is never written, whatever the plan says. */
  sessionQueryKey: QueryKey;
  versions?: UiQueryVersions;
  /** The `x-lw-schema` the server last answered a read's path under, if any. */
  servedSchemaHashFor?: (path: string) => string | undefined;
}): { unsubscribe: () => void; restored: Promise<void> } {
  const sessionHash = hashKey(sessionQueryKey);
  const isPersisted = (query: Query) =>
    query.queryHash !== sessionHash && plan.persisted.has(procedurePathOf(query.queryKey) ?? "");
  const restoredAt = restoredAtOf(queryClient);
  let stopped = false;
  const stopMirroring = queryClient.getQueryCache().subscribe((event) =>
    mirrorQuery({
      event,
      isPersisted,
      plan,
      servedSchemaHashFor,
      restoredAt,
      versions,
      store,
      userId,
    }),
  );
  const unsubscribe = () => {
    stopped = true;
    stopMirroring();
  };

  const restore = async () => {
    const prefix = storedQueryKey({ userId, queryHash: "" });
    const owned = (await store.keys()).filter((key) => key.startsWith(prefix));
    const entries = await Promise.all(owned.map((key) => readStoredQuery({ store, key, plan })));
    for (const entry of entries) {
      if (stopped) return;
      if (entry) {
        restoreStoredQuery({ entry, queryClient, versions, restoredAt });
      }
    }
  };

  const restored = clearPersistedUiQueries({ store, keepUserId: userId })
    .then(restore)
    .then(() => (stopped ? void 0 : queryClient.invalidateQueries({ predicate: isPersisted })));

  return { unsubscribe, restored };
}
