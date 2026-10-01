/**
 * Cross-tab sync: versions travel, data never does. specs/ui/browser-query-caching.feature.
 */

import { trpcQueryKey } from "@langwatch/api/web";
import { focusManager, hashKey, QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import type { UiCachePlan } from "../cache-tiers.ts";
import { sealedUiQueryStore, storedQueryKey, type UiQueryStore } from "../query-persistence.ts";
import { digestOf, startUiQuerySync, uiQuerySyncChannelName } from "../query-sync.ts";

const plan: UiCachePlan = {
  persisted: new Set(["organization.getScopeGraph"]),
  schemaHashFor: (path) => (path === "organization.getScopeGraph" ? "schema-1" : undefined),
};

const graphKey = trpcQueryKey("organization.getScopeGraph", { input: {}, type: "query" });
const graphHash = hashKey(graphKey);
const projectsKey = trpcQueryKey("project.getAll", { input: {}, type: "query" });

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

function fakeChannel() {
  const sent: unknown[] = [];
  return {
    sent,
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: (message: unknown) => void sent.push(message),
    close: () => void 0,
  };
}

function tab(queryClient = new QueryClient()) {
  const channel = fakeChannel();
  const versions = new Map<string, string>();
  const store = memoryStore();
  const stop = startUiQuerySync({
    queryClient,
    plan,
    store,
    userId: "alice",
    versions,
    channel,
  });
  return { queryClient, channel, versions, store, stop };
}

describe("startUiQuerySync", () => {
  describe("given another tab announces a version this tab does not hold", () => {
    /** @scenario "A tab behind an announced version marks the read stale without fetching" */
    it("marks the read stale without fetching", async () => {
      const { queryClient, channel, versions, stop } = tab();
      queryClient.setQueryData(graphKey, ["acme"]);
      versions.set(graphHash, "u.v1");

      channel.onmessage?.(
        new MessageEvent("message", { data: { key: graphHash, version: "u.v2" } }),
      );
      await Promise.resolve();

      expect(queryClient.getQueryState(graphKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(graphKey)?.fetchStatus).toBe("idle");
      stop();
    });
  });

  describe("given another tab announces the version this tab already holds", () => {
    /** @scenario "A tab already at the announced version does nothing" */
    it("changes nothing", async () => {
      const { queryClient, channel, versions, stop } = tab();
      queryClient.setQueryData(graphKey, ["acme"]);
      versions.set(graphHash, "u.v1");

      channel.onmessage?.(
        new MessageEvent("message", { data: { key: graphHash, version: "u.v1" } }),
      );
      await Promise.resolve();

      expect(queryClient.getQueryState(graphKey)?.isInvalidated).toBe(false);
      stop();
    });
  });

  describe("given a message that is not a key and a version", () => {
    /** @scenario "A message that is not a key and a version is ignored" */
    it("is ignored", async () => {
      const { queryClient, channel, stop } = tab();
      queryClient.setQueryData(graphKey, ["acme"]);

      channel.onmessage?.(new MessageEvent("message", { data: { key: graphHash } }));
      await Promise.resolve();

      expect(queryClient.getQueryState(graphKey)?.isInvalidated).toBe(false);
      stop();
    });
  });

  describe("given a fetch lands in a visible tab", () => {
    /** @scenario "A fetch in a visible tab announces its version, never its data" */
    it("broadcasts the key and version, never the data", async () => {
      const { queryClient, channel, versions, stop } = tab();
      versions.set(graphHash, "u.v1");

      await queryClient.fetchQuery({ queryKey: graphKey, queryFn: async () => ["acme"] });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(channel.sent).toEqual([{ key: graphHash, version: "u.v1" }]);
      stop();
    });
  });

  describe("given the mirrored copy is newer than this tab's", () => {
    /** @scenario "Gaining focus reads the disk before the network" */
    it("adopts it on focus instead of fetching", async () => {
      const { queryClient, channel, versions, store, stop } = tab();
      queryClient.setQueryData(graphKey, ["old"], { updatedAt: 1 });
      versions.set(graphHash, "u.v1");
      store.entries.set(storedQueryKey({ userId: "alice", queryHash: graphHash }), {
        queryKey: graphKey,
        data: ["new"],
        version: "u.v2",
        updatedAt: Date.now(),
        schemaHash: "schema-1",
      });
      channel.onmessage?.(
        new MessageEvent("message", { data: { key: graphHash, version: "u.v2" } }),
      );
      await Promise.resolve();

      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(queryClient.getQueryData(graphKey)).toEqual(["new"]);
      expect(versions.get(graphHash)).toBe("u.v2");
      expect(queryClient.getQueryState(graphKey)?.isInvalidated).toBe(false);
      focusManager.setFocused(undefined);
      stop();
    });
  });

  describe("given the tab regains focus with mounted reads", () => {
    /** @scenario "A read is trusted for five minutes and refetched on focus only when stale" */
    it("fires one revalidation pass: each stale read once, a fresh one never", async () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { refetchOnWindowFocus: false } },
      });
      const { stop } = tab(queryClient);
      const fetches = { graph: 0, projects: 0, fresh: 0 };
      const mounts = [
        { queryKey: graphKey, counter: "graph", staleTime: 0 },
        { queryKey: projectsKey, counter: "projects", staleTime: 0 },
        { queryKey: [...projectsKey, "fresh"], counter: "fresh", staleTime: 60_000 },
      ] as const;
      const unsubscribe = mounts.map(({ queryKey, counter, staleTime }) =>
        new QueryObserver(queryClient, {
          queryKey,
          staleTime,
          queryFn: async () => ({ fetch: ++fetches[counter] }),
        }).subscribe(() => void 0),
      );
      await vi.waitFor(() => expect(fetches).toEqual({ graph: 1, projects: 1, fresh: 1 }));

      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(fetches).toEqual({ graph: 2, projects: 2, fresh: 1 });
      focusManager.setFocused(undefined);
      unsubscribe.forEach((off) => off());
      stop();
    });
  });

  describe("given a hint was dropped while the tab was hidden", () => {
    /** @scenario "A tab shown again catches up the stale reads it holds" */
    it("refetches the stale mounted read once when the tab is shown", async () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { refetchOnWindowFocus: false } },
      });
      const { stop } = tab(queryClient);
      let fetches = 0;
      const unsubscribe = new QueryObserver(queryClient, {
        queryKey: projectsKey,
        staleTime: 60_000,
        queryFn: async () => ({ fetch: ++fetches }),
      }).subscribe(() => void 0);
      await vi.waitFor(() => expect(fetches).toBe(1));

      focusManager.setFocused(false);
      await queryClient.invalidateQueries({ queryKey: projectsKey, refetchType: "none" });
      expect(fetches).toBe(1);
      focusManager.setFocused(true);
      await vi.waitFor(() => expect(fetches).toBe(2));

      focusManager.setFocused(undefined);
      unsubscribe();
      stop();
    });
  });

  describe("given a stale read already fetching when the tab is shown", () => {
    /** @scenario "A tab shown again leaves a fetch in flight to finish" */
    it("does not abort the fetch and start it a second time", async () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { refetchOnWindowFocus: false } },
      });
      const { stop } = tab(queryClient);
      let fetches = 0;
      const unsubscribe = new QueryObserver(queryClient, {
        queryKey: projectsKey,
        queryFn: async () => {
          const attempt = ++fetches;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { attempt };
        },
      }).subscribe(() => void 0);

      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(fetches).toBe(1);
      focusManager.setFocused(undefined);
      unsubscribe();
      stop();
    });
  });

  describe("given the stored copy was sealed under a key this tab does not hold", () => {
    /** @scenario "A row from another session is a miss and is refetched" */
    it("does not adopt it on focus, and removes it", async () => {
      const disk = memoryStore();
      const rowKey = storedQueryKey({ userId: "alice", queryHash: graphHash });
      const sealedUnder = (cacheKey: string) =>
        sealedUiQueryStore({ store: disk, cacheKey, previousCacheKey: void 0 });
      await sealedUnder("AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=").put(rowKey, {
        queryKey: graphKey,
        data: ["new"],
        version: "u.v2",
        updatedAt: Date.now(),
        schemaHash: "schema-1",
      });
      const queryClient = new QueryClient();
      const channel = fakeChannel();
      const stop = startUiQuerySync({
        queryClient,
        plan,
        store: sealedUnder("AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI="),
        userId: "alice",
        versions: new Map([[graphHash, "u.v1"]]),
        channel,
      });
      queryClient.setQueryData(graphKey, ["old"], { updatedAt: 1 });
      channel.onmessage?.(
        new MessageEvent("message", { data: { key: graphHash, version: "u.v2" } }),
      );
      await Promise.resolve();

      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(queryClient.getQueryData(graphKey)).toEqual(["old"]);
      expect(disk.entries.has(rowKey)).toBe(false);
      focusManager.setFocused(undefined);
      stop();
    });
  });
});

describe("the sync digest and channel", () => {
  /** @scenario "A fetch in a visible tab announces its version, never its data" */
  it("broadcasts an opaque digest of an unversioned read, never its body", async () => {
    const { queryClient, channel, stop } = tab();

    await queryClient.fetchQuery({ queryKey: graphKey, queryFn: async () => ["acme-ltd"] });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(JSON.stringify(channel.sent)).not.toContain("acme-ltd");
    expect(channel.sent).toEqual([
      { key: graphHash, version: digestOf({ text: hashKey([["acme-ltd"]]) }) },
    ]);
    stop();
  });

  it("gives equal data an equal digest and different data a different one", () => {
    expect(digestOf({ text: "a" })).toBe(digestOf({ text: "a" }));
    expect(digestOf({ text: "a" })).not.toBe(digestOf({ text: "b" }));
  });

  it("names the channel per user", () => {
    expect(uiQuerySyncChannelName({ userId: "alice" })).not.toBe(
      uiQuerySyncChannelName({ userId: "bob" }),
    );
  });
});
