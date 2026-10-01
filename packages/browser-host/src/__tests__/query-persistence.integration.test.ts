/**
 * Mirroring marked reads across a reload, one object per query, per user and per build, over an
 * in-memory store. ADR-164; specs/ui/browser-query-caching.feature.
 */

import { trpcQueryKey } from "@langwatch/api/web";
import { hashKey, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { cachePlanFor } from "../cache-tiers.ts";
import {
  clearPersistedUiQueries,
  indexedDbQueryStore,
  persistUiQueries,
  type UiStoredQuery,
  type UiQueryStore,
} from "../query-persistence.ts";

const plan = cachePlanFor({
  contracts: [
    {
      namespace: "organization",
      members: { getAll: { cache: { tier: "session", persist: true } }, getMemberById: {} },
    },
  ],
});

const orgGraph = trpcQueryKey("organization.getAll", { input: {}, type: "query" });
const member = trpcQueryKey("organization.getMemberById", { input: { id: "u" }, type: "query" });

function memoryStore(): UiQueryStore & { entries: Map<string, unknown> } {
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
  write,
  versions = new Map<string, string>(),
}: {
  store: UiQueryStore;
  userId: string;
  buildId?: string;
  write?: (queryClient: QueryClient) => void;
  versions?: Map<string, string>;
}): Promise<QueryClient> {
  const queryClient = new QueryClient();
  const { unsubscribe, restored } = persistUiQueries({
    queryClient,
    plan,
    userId,
    buildId,
    store,
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
    it("paints it from disk and marks it for revalidation", async () => {
      const store = memoryStore();
      await session({ store, userId: "alice", write: (qc) => qc.setQueryData(orgGraph, ["acme"]) });

      const reloaded = await session({ store, userId: "alice" });

      expect(reloaded.getQueryData(orgGraph)).toEqual(["acme"]);
      expect(reloaded.getQueryState(orgGraph)?.isInvalidated).toBe(true);
    });
  });

  describe("given an unmarked read", () => {
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

      const saved = [...store.entries.keys()].length;
      expect(saved).toBe(1);
      const stored = [...store.entries.values()].map((entry) => JSON.stringify(entry)).join("");
      expect(stored).toContain("getAll");
      expect(stored).not.toContain("getMemberById");
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

      expect([...store.entries.values()].some((entry) => isOfBuild(entry, "build-1"))).toBe(false);
    });
  });
});

function isOfBuild(entry: unknown, buildId: string): boolean {
  return (
    typeof entry === "object" && entry !== null && "buildId" in entry && entry.buildId === buildId
  );
}

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
    it("wipes every persisted cache and nothing else", async () => {
      const store = memoryStore();
      await session({ store, userId: "alice", write: (qc) => qc.setQueryData(orgGraph, ["acme"]) });
      store.entries.set("unrelated", "kept");

      await clearPersistedUiQueries({ store });

      expect([...store.entries.keys()]).toEqual(["unrelated"]);
    });
  });
});
