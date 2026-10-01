// @vitest-environment jsdom
/**
 * A restored read says how old it is and whether the network has confirmed it since.
 * specs/ui/browser-query-caching.feature.
 */

import { trpcQueryKey } from "@langwatch/api/web";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { cachePlanFor } from "../cache-tiers.ts";
import { persistUiQueries, sealedUiQueryStore, type UiQueryStore } from "../query-persistence.ts";
import { useReadFreshness } from "../read-freshness.ts";

const plan = cachePlanFor({
  contracts: [
    {
      namespace: "organization",
      members: { getAll: { cache: { persist: true } } },
    },
  ],
});
const orgGraph = trpcQueryKey("organization.getAll", { input: {}, type: "query" });
const sessionRead = ["test", "session"];
const KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
const FETCHED_AT = Date.now() - 60_000;

function memoryStore(): UiQueryStore<unknown> {
  const entries = new Map<string, unknown>();
  return {
    get: async (key) => entries.get(key),
    put: async (key, value) => void entries.set(key, value),
    delete: async (key) => void entries.delete(key),
    keys: async () => [...entries.keys()],
  };
}

/** A document that restored the organization graph fetched a minute ago in an earlier one. */
async function restoredDocument(): Promise<QueryClient> {
  const disk = memoryStore();
  const mirror = (queryClient: QueryClient) =>
    persistUiQueries({
      queryClient,
      plan,
      userId: "alice",
      buildId: "b1",
      store: sealedUiQueryStore({ store: disk, cacheKey: KEY, previousCacheKey: void 0 }),
      sessionQueryKey: sessionRead,
    });
  const earlier = new QueryClient();
  const first = mirror(earlier);
  await first.restored;
  earlier.setQueryData(orgGraph, ["acme"], { updatedAt: FETCHED_AT });
  await new Promise((resolve) => setTimeout(resolve, 50));
  first.unsubscribe();

  const reloaded = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await mirror(reloaded).restored;
  return reloaded;
}

function freshnessIn(queryClient: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useReadFreshness({ queryKey: orgGraph }), { wrapper });
}

describe("useReadFreshness", () => {
  describe("given a read restored from disk", () => {
    /** @scenario "Restored data is unconfirmed, as of its original fetch" */
    it("is unconfirmed, as of the time it was originally fetched", async () => {
      const queryClient = await restoredDocument();

      const { result } = freshnessIn(queryClient);

      expect(result.current.confirmed).toBe(false);
      expect(result.current.asOf?.epochMilliseconds).toBe(FETCHED_AT);
    });
  });

  describe("when a fetch lands for it", () => {
    /** @scenario "A restored read is confirmed when a fetch lands" */
    it("is confirmed, as of the new answer", async () => {
      const queryClient = await restoredDocument();
      const { result } = freshnessIn(queryClient);

      await act(() => queryClient.fetchQuery({ queryKey: orgGraph, queryFn: async () => ["new"] }));

      await waitFor(() => expect(result.current.confirmed).toBe(true));
      expect(result.current.asOf?.epochMilliseconds).toBeGreaterThan(FETCHED_AT);
    });
  });

  describe("when a fetch for it fails", () => {
    /** @scenario "A failed fetch leaves a restored read unconfirmed" */
    it("stays unconfirmed, as of the original fetch", async () => {
      const queryClient = await restoredDocument();
      const { result } = freshnessIn(queryClient);

      await act(() =>
        queryClient
          .fetchQuery({
            queryKey: orgGraph,
            queryFn: async (): Promise<string[]> => {
              throw new Error("offline");
            },
          })
          .catch(() => void 0),
      );

      expect(result.current.confirmed).toBe(false);
      expect(result.current.asOf?.epochMilliseconds).toBe(FETCHED_AT);
    });
  });
});
