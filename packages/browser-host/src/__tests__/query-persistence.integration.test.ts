/**
 * Persisting marked reads across a reload, per user and per build, over an
 * in-memory store. ADR-164; specs/ui/browser-query-caching.feature.
 */

import { trpcQueryKey } from "@langwatch/api/web";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { cachePlanFor } from "../cache-tiers.ts";
import {
  clearPersistedUiQueries,
  persistUiQueries,
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

function memoryStore(): UiQueryStore & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: async (key) => entries.get(key),
    setItem: async (key, value) => entries.set(key, value),
    removeItem: async (key) => void entries.delete(key),
    keys: async () => [...entries.keys()],
  };
}

/** One document's life: restore, optionally write, let the throttled save land, go away. */
async function session({
  store,
  userId,
  buildId = "build-1",
  write,
}: {
  store: UiQueryStore;
  userId: string;
  buildId?: string;
  write?: (queryClient: QueryClient) => void;
}): Promise<QueryClient> {
  const queryClient = new QueryClient();
  const { unsubscribe, restored } = persistUiQueries({ queryClient, plan, userId, buildId, store });
  await restored;
  write?.(queryClient);
  await new Promise((resolve) => setTimeout(resolve, 1_100));
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

      const saved = [...store.entries.values()].join("");
      expect(saved).toContain("getAll");
      expect(saved).not.toContain("getMemberById");
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

describe("clearPersistedUiQueries", () => {
  describe("when the user logs out", () => {
    it("wipes every persisted cache and nothing else", async () => {
      const store = memoryStore();
      await session({ store, userId: "alice", write: (qc) => qc.setQueryData(orgGraph, ["acme"]) });
      await store.setItem("unrelated", "kept");

      await clearPersistedUiQueries({ store });

      expect([...store.entries.keys()]).toEqual(["unrelated"]);
    });
  });
});
