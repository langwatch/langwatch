/**
 * Mirroring marked reads across a reload, one sealed object per query, per user and per build,
 * over an in-memory store. ADR-164; specs/ui/browser-query-caching.feature.
 */

import { trpcQueryKey } from "@langwatch/api/web";
import { hashKey, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { cachePlanFor } from "../cache-tiers.ts";
import {
  clearPersistedUiQueries,
  indexedDbQueryStore,
  persistUiQueries,
  sealedUiQueryStore,
  storedQueryKey,
  type UiStoredQuery,
  type UiQueryStore,
} from "../query-persistence.ts";

const plan = cachePlanFor({
  contracts: [
    {
      namespace: "organization",
      members: { getAll: { cache: { persist: true } }, getMemberById: {} },
    },
    // Marked persist on purpose: the session read is excluded by key, whatever the plan says.
    { namespace: "auth", members: { session: { cache: { persist: true } } } },
  ],
});

/** Three users' or epochs' keys: 32 bytes each, base64, as the session read carries them. */
const KEY_1 = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
const KEY_2 = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=";
const KEY_3 = "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM=";
const sessionRead = trpcQueryKey("auth.session", { input: {}, type: "query" });

const orgGraph = trpcQueryKey("organization.getAll", { input: {}, type: "query" });
const member = trpcQueryKey("organization.getMemberById", { input: { id: "u" }, type: "query" });

function memoryStore(): UiQueryStore<unknown> & { entries: Map<string, unknown> } {
  const entries = new Map<string, unknown>();
  return {
    entries,
    get: async (key) => entries.get(key),
    put: async (key, value) => void entries.set(key, value),
    delete: async (key) => void entries.delete(key),
    keys: async () => [...entries.keys()],
  };
}

/** One document's life: restore, optionally write, let the throttled save land, go away. */
async function session({
  store,
  userId,
  buildId = "build-1",
  cacheKey = KEY_1,
  previousCacheKey,
  write,
  versions = new Map<string, string>(),
}: {
  store: UiQueryStore<unknown>;
  userId: string;
  buildId?: string;
  cacheKey?: string;
  previousCacheKey?: string;
  write?: (queryClient: QueryClient) => void;
  versions?: Map<string, string>;
}): Promise<QueryClient> {
  const queryClient = new QueryClient();
  const { unsubscribe, restored } = persistUiQueries({
    queryClient,
    plan,
    userId,
    buildId,
    store: sealedUiQueryStore({ store, cacheKey, previousCacheKey }),
    sessionQueryKey: sessionRead,
    versions,
  });
  await restored;
  write?.(queryClient);
  await new Promise((resolve) => setTimeout(resolve, 50));
  unsubscribe();
  return queryClient;
}

describe("persistUiQueries", () => {
  describe("given a marked read cached before a reload", () => {
    /** @scenario "A reload paints a persisted read from disk, then revalidates it" */
    it("paints it from disk and marks it for revalidation", async () => {
      const store = memoryStore();
      await session({ store, userId: "alice", write: (qc) => qc.setQueryData(orgGraph, ["acme"]) });

      const reloaded = await session({ store, userId: "alice" });

      expect(reloaded.getQueryData(orgGraph)).toEqual(["acme"]);
      expect(reloaded.getQueryState(orgGraph)?.isInvalidated).toBe(true);
    });
  });

  describe("given an unmarked read", () => {
    /** @scenario "A read not marked persist never reaches the disk" */
    it("never reaches the store", async () => {
      const store = memoryStore();
      await session({
        store,
        userId: "alice",
        write: (qc) => {
          qc.setQueryData(orgGraph, ["acme"]);
          qc.setQueryData(member, { id: "u" });
        },
      });

      expect([...store.entries.keys()]).toEqual([
        storedQueryKey({ userId: "alice", queryHash: hashKey(orgGraph) }),
      ]);
    });
  });

  describe("given another user signs in on the same device", () => {
    it("never shows the previous user's cache and removes it", async () => {
      const store = memoryStore();
      await session({ store, userId: "alice", write: (qc) => qc.setQueryData(orgGraph, ["acme"]) });

      const bob = await session({ store, userId: "bob" });

      expect(bob.getQueryData(orgGraph)).toBeUndefined();
      expect([...store.entries.keys()].some((key) => key.includes("alice"))).toBe(false);
    });
  });

  describe("given the build changed since the cache was written", () => {
    /** @scenario "A build change discards the store" */
    it("discards the store", async () => {
      const store = memoryStore();
      await session({ store, userId: "alice", write: (qc) => qc.setQueryData(orgGraph, ["acme"]) });

      const next = await session({ store, userId: "alice", buildId: "build-2" });

      expect(next.getQueryData(orgGraph)).toBeUndefined();
    });
  });
});

describe("persistUiQueries versions", () => {
  describe("given a versioned read was mirrored before a reload", () => {
    /** @scenario "A restored version is sent as since" */
    it("restores the version so the first fetch can send it as since", async () => {
      const store = memoryStore();
      const versions = new Map<string, string>();
      await session({
        store,
        userId: "alice",
        versions,
        write: (qc) => {
          versions.set(hashKey(orgGraph), "u.v1");
          qc.setQueryData(orgGraph, ["acme"]);
        },
      });

      const reloadedVersions = new Map<string, string>();
      await session({ store, userId: "alice", versions: reloadedVersions });

      expect(reloadedVersions.get(hashKey(orgGraph))).toBe("u.v1");
    });
  });

  describe("given an entry that is corrupt", () => {
    /** @scenario "A corrupt entry is dropped and the rest restore" */
    it("drops it and restores the rest", async () => {
      const store = memoryStore();
      await session({ store, userId: "alice", write: (qc) => qc.setQueryData(orgGraph, ["acme"]) });
      store.entries.set("lw-query:alice:broken", { data: "no query key" });

      const reloaded = await session({ store, userId: "alice" });

      expect(reloaded.getQueryData(orgGraph)).toEqual(["acme"]);
      expect(store.entries.has("lw-query:alice:broken")).toBe(false);
    });
  });

  describe("given an entry written by another build", () => {
    it("ignores it and removes it", async () => {
      const store = memoryStore();
      await session({ store, userId: "alice", write: (qc) => qc.setQueryData(orgGraph, ["acme"]) });

      await session({ store, userId: "alice", buildId: "build-2" });

      expect(store.entries.size).toBe(0);
    });
  });
});

describe("persistUiQueries sealing", () => {
  const written = () => {
    const store = memoryStore();
    const write = (qc: QueryClient) => qc.setQueryData(orgGraph, ["acme"]);
    return { store, write };
  };
  const orgRow = storedQueryKey({ userId: "alice", queryHash: hashKey(orgGraph) });

  describe("given a row sealed under this session's key", () => {
    /** @scenario "A sealed row restores on a refresh in the same session" */
    it("restores it on a refresh in the same session, and never holds the data in clear", async () => {
      const { store, write } = written();
      await session({ store, userId: "alice", cacheKey: KEY_1, write });

      const reloaded = await session({ store, userId: "alice", cacheKey: KEY_1 });

      expect(reloaded.getQueryData(orgGraph)).toEqual(["acme"]);
      expect(JSON.stringify([...store.entries.values()])).not.toContain("acme");
    });
  });

  describe("given a row sealed by an earlier session, after a re-login", () => {
    /** @scenario "A row from another session is a miss and is refetched" */
    it("restores nothing and removes the row", async () => {
      const { store, write } = written();
      await session({ store, userId: "alice", cacheKey: KEY_1, write });

      const reloaded = await session({ store, userId: "alice", cacheKey: KEY_2 });

      expect(reloaded.getQueryData(orgGraph)).toBeUndefined();
      expect(store.entries.has(orgRow)).toBe(false);
    });
  });

  describe("given a row sealed last epoch", () => {
    /** @scenario "A row sealed last epoch restores and is re-sealed with this epoch's key" */
    it("restores it under last epoch's key and re-seals it under this one", async () => {
      const { store, write } = written();
      await session({ store, userId: "alice", cacheKey: KEY_1, write });

      const reloaded = await session({
        store,
        userId: "alice",
        cacheKey: KEY_2,
        previousCacheKey: KEY_1,
      });
      const resealed = await session({ store, userId: "alice", cacheKey: KEY_2 });

      expect(reloaded.getQueryData(orgGraph)).toEqual(["acme"]);
      expect(resealed.getQueryData(orgGraph)).toEqual(["acme"]);
    });
  });

  describe("given a row sealed two epochs ago", () => {
    /** @scenario "A row sealed two epochs ago is a miss" */
    it("restores nothing and removes the row", async () => {
      const { store, write } = written();
      await session({ store, userId: "alice", cacheKey: KEY_1, write });

      const reloaded = await session({
        store,
        userId: "alice",
        cacheKey: KEY_3,
        previousCacheKey: KEY_2,
      });

      expect(reloaded.getQueryData(orgGraph)).toBeUndefined();
      expect(store.entries.has(orgRow)).toBe(false);
    });
  });

  describe("given a row whose sealed bytes were changed on disk", () => {
    /** @scenario "A tampered row is a miss" */
    it("restores nothing and removes the row", async () => {
      const { store, write } = written();
      await session({ store, userId: "alice", cacheKey: KEY_1, write });
      const row = store.entries.get(orgRow);
      if (typeof row !== "object" || row === null || !("sealed" in row)) {
        throw new Error("the row was not sealed");
      }
      const { sealed } = row;
      if (!(sealed instanceof Uint8Array)) throw new Error("the row holds no sealed bytes");
      sealed[0] = (sealed[0] ?? 0) ^ 0xff;

      const reloaded = await session({ store, userId: "alice", cacheKey: KEY_1 });

      expect(reloaded.getQueryData(orgGraph)).toBeUndefined();
      expect(store.entries.has(orgRow)).toBe(false);
    });
  });

  describe("given a row moved under another query's key", () => {
    it("restores nothing there, since each row is bound to its own key", async () => {
      const { store, write } = written();
      await session({ store, userId: "alice", cacheKey: KEY_1, write });
      const moved = storedQueryKey({ userId: "alice", queryHash: "elsewhere" });
      store.entries.set(moved, store.entries.get(orgRow));
      store.entries.delete(orgRow);

      await session({ store, userId: "alice", cacheKey: KEY_1 });

      expect(store.entries.has(moved)).toBe(false);
    });
  });

  describe("given the session read answers while the cache is mirrored", () => {
    /** @scenario "The session read is never mirrored" */
    it("writes no row for it, even with its path marked persist", async () => {
      const store = memoryStore();

      await session({
        store,
        userId: "alice",
        write: (qc) => qc.setQueryData(sessionRead, { cacheKey: KEY_1 }),
      });

      expect(store.entries.size).toBe(0);
    });
  });
});

describe("sealedUiQueryStore budget", () => {
  const row = (data: unknown): UiStoredQuery => ({
    queryKey: orgGraph,
    data,
    updatedAt: 1,
    buildId: "b1",
  });
  /** A mirror whose clock the test moves, under a budget of two rows. */
  const mirror = (store: UiQueryStore<unknown>, clock: { at: number }, maxRowBytes = 10_000) =>
    sealedUiQueryStore({
      store,
      cacheKey: KEY_1,
      previousCacheKey: void 0,
      budget: { maxBytes: 1_000_000, maxRows: 2, maxRowBytes },
      now: () => clock.at,
    });

  describe("given a write that takes the mirror over budget", () => {
    /** @scenario "Over budget, the least recently read row is evicted" */
    it("evicts the least recently read row, including rows known from the restore", async () => {
      const disk = memoryStore();
      const clock = { at: 1 };
      const earlier = mirror(disk, clock);
      await earlier.put("lw-query:alice:a", row("a"));
      clock.at = 2;
      await earlier.put("lw-query:alice:b", row("b"));

      const reloaded = mirror(disk, clock);
      await reloaded.get("lw-query:alice:a");
      await reloaded.get("lw-query:alice:b");
      clock.at = 3;
      await reloaded.put("lw-query:alice:c", row("c"));

      expect([...disk.entries.keys()].toSorted()).toEqual(["lw-query:alice:b", "lw-query:alice:c"]);
    });
  });

  describe("given a row read since it was written", () => {
    /** @scenario "Reading a row protects it from eviction" */
    it("keeps it and evicts the one nobody read", async () => {
      const disk = memoryStore();
      const clock = { at: 1 };
      const store = mirror(disk, clock);
      await store.put("lw-query:alice:a", row("a"));
      clock.at = 2;
      await store.put("lw-query:alice:b", row("b"));
      clock.at = 3;
      store.touch("lw-query:alice:a");
      clock.at = 4;
      await store.put("lw-query:alice:c", row("c"));

      expect([...disk.entries.keys()].toSorted()).toEqual(["lw-query:alice:a", "lw-query:alice:c"]);
    });
  });

  describe("given a row larger than one row may be", () => {
    /** @scenario "A row too large is not mirrored" */
    it("writes nothing, and removes the smaller copy it would have replaced", async () => {
      const disk = memoryStore();
      const clock = { at: 1 };
      const store = mirror(disk, clock, 200);
      await store.put("lw-query:alice:a", row("small"));

      await store.put("lw-query:alice:a", row("x".repeat(500)));

      expect(disk.entries.size).toBe(0);
    });
  });
});

describe("indexedDbQueryStore", () => {
  describe("given IndexedDB is unavailable", () => {
    /** @scenario "Without IndexedDB the cache lives in memory" */
    it("keeps the entry in memory for this document", async () => {
      const entry: UiStoredQuery = { queryKey: ["a"], data: 1, updatedAt: 1, buildId: "b" };

      await indexedDbQueryStore.put("lw-query:alice:x", entry);

      expect(await indexedDbQueryStore.get("lw-query:alice:x")).toEqual(entry);
      await indexedDbQueryStore.delete("lw-query:alice:x");
      expect(await indexedDbQueryStore.get("lw-query:alice:x")).toBeUndefined();
    });
  });
});

describe("clearPersistedUiQueries", () => {
  describe("when the user logs out", () => {
    /** @scenario "Logout wipes the store" */
    it("wipes every persisted cache and nothing else", async () => {
      const store = memoryStore();
      await session({ store, userId: "alice", write: (qc) => qc.setQueryData(orgGraph, ["acme"]) });
      store.entries.set("unrelated", "kept");

      await clearPersistedUiQueries({ store });

      expect([...store.entries.keys()]).toEqual(["unrelated"]);
    });
  });
});

describe("persistUiQueries refusal and teardown", () => {
  const orgRow = storedQueryKey({ userId: "alice", queryHash: hashKey(orgGraph) });

  describe("given a persisted read is answered 403", () => {
    /** @scenario "A forbidden read removes its persisted row" */
    it("removes that read's row from disk", async () => {
      const store = memoryStore();
      await session({
        store,
        userId: "alice",
        write: (qc) => qc.setQueryData(orgGraph, ["acme"]),
      });
      expect(store.entries.has(orgRow)).toBe(true);

      await session({
        store,
        userId: "alice",
        write: (qc) =>
          void qc
            .fetchQuery({
              queryKey: orgGraph,
              queryFn: () => Promise.reject({ data: { httpStatus: 403 } }),
              retry: false,
            })
            .catch(() => void 0),
      });

      expect(store.entries.has(orgRow)).toBe(false);
    });
  });

  describe("given the mirror is detached before its restore finishes", () => {
    /** @scenario "A session change starts a fresh cache" */
    it("installs nothing from the old restore", async () => {
      const store = memoryStore();
      await session({ store, userId: "alice", write: (qc) => qc.setQueryData(orgGraph, ["acme"]) });
      const queryClient = new QueryClient();

      const { unsubscribe, restored } = persistUiQueries({
        queryClient,
        plan,
        userId: "alice",
        buildId: "build-1",
        store: sealedUiQueryStore({ store, cacheKey: KEY_1, previousCacheKey: undefined }),
        sessionQueryKey: sessionRead,
      });
      unsubscribe();
      await restored;

      expect(queryClient.getQueryData(orgGraph)).toBeUndefined();
    });
  });
});
