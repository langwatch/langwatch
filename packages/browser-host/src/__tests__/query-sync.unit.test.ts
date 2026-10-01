/**
 * Cross-tab sync: versions travel, data never does. specs/ui/browser-query-caching.feature.
 */

import { trpcQueryKey } from "@langwatch/api/web";
import { focusManager, hashKey, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { cachePlanFor } from "../cache-tiers.ts";
import { sealedUiQueryStore, storedQueryKey, type UiQueryStore } from "../query-persistence.ts";
import { digestOf, startUiQuerySync, uiQuerySyncChannelName } from "../query-sync.ts";

const plan = cachePlanFor({
  contracts: [
    {
      namespace: "organization",
      members: { getScopeGraph: { cache: { persist: true } } },
    },
  ],
});

const graphKey = trpcQueryKey("organization.getScopeGraph", { input: {}, type: "query" });
const graphHash = hashKey(graphKey);

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

function tab() {
  const queryClient = new QueryClient();
  const channel = fakeChannel();
  const versions = new Map<string, string>();
  const store = memoryStore();
  const stop = startUiQuerySync({
    queryClient,
    plan,
    store,
    userId: "alice",
    buildId: "b1",
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

  describe("given a fetch lands in the focused tab", () => {
    /** @scenario "A fetch in the focused tab announces its version, never its data" */
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
        buildId: "b1",
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
        buildId: "b1",
      });
      const queryClient = new QueryClient();
      const channel = fakeChannel();
      const stop = startUiQuerySync({
        queryClient,
        plan,
        store: sealedUnder("AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI="),
        userId: "alice",
        buildId: "b1",
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
  /** @scenario "A fetch in the focused tab announces its version, never its data" */
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
