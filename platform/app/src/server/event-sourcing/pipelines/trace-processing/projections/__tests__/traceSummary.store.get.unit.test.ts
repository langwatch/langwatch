import { describe, expect, it, vi } from "vitest";
import { createTenantId } from "../../../../domain/tenantId";
import { CachedFoldStore } from "../../../../projections/cachedFoldStore";
import { InMemoryFoldCacheClient } from "../../../../projections/foldCache/foldCacheClient";
import type { ProjectionStoreContext } from "../../../../projections/projectionStoreContext";
import { TraceSummaryStore } from "../traceSummary.store";

function storeWithRepo() {
  const findByTraceIdWithVersion = vi.fn().mockResolvedValue(null);
  const store = new TraceSummaryStore({ findByTraceIdWithVersion } as any);
  return { store, findByTraceIdWithVersion };
}

describe("TraceSummaryStore.get", () => {
  const tenantId = createTenantId("project-1");

  describe("given the context carries the executor-computed readWindow", () => {
    it("forwards it verbatim as the repository read window", async () => {
      const { store, findByTraceIdWithVersion } = storeWithRepo();
      const context: ProjectionStoreContext = {
        aggregateId: "trace-1",
        tenantId,
        occurredAtMs: 1700000000000,
        readWindow: { fromMs: 1699900000000, toMs: 1700100000000 },
      };

      await store.get("trace-1", context);

      expect(findByTraceIdWithVersion).toHaveBeenCalledWith(
        "project-1",
        "trace-1",
        {
          window: { fromMs: 1699900000000, toMs: 1700100000000 },
        },
      );
    });
  });

  describe("given the context has no readWindow", () => {
    it("reads without a bound (unbounded, still correct)", async () => {
      const { store, findByTraceIdWithVersion } = storeWithRepo();
      const context: ProjectionStoreContext = {
        aggregateId: "trace-1",
        tenantId,
      };

      await store.get("trace-1", context);

      expect(findByTraceIdWithVersion).toHaveBeenCalledWith(
        "project-1",
        "trace-1",
        undefined,
      );
    });

    it("does not derive a window from occurredAtMs on its own", async () => {
      const { store, findByTraceIdWithVersion } = storeWithRepo();
      const context: ProjectionStoreContext = {
        aggregateId: "trace-1",
        tenantId,
        occurredAtMs: 1700000000000,
      };

      await store.get("trace-1", context);

      expect(findByTraceIdWithVersion).toHaveBeenCalledWith(
        "project-1",
        "trace-1",
        undefined,
      );
    });
  });
});

describe("TraceSummaryStore under the fold cache", () => {
  const tenantId = createTenantId("project-1");
  const context: ProjectionStoreContext = {
    aggregateId: "trace-1",
    tenantId,
  };

  function cachedStore() {
    const findByTraceIdWithVersion = vi.fn().mockResolvedValue(null);
    const upsert = vi.fn().mockResolvedValue(undefined);
    const inner = new TraceSummaryStore({
      findByTraceIdWithVersion,
      upsert,
    } as any);
    const cache = new InMemoryFoldCacheClient();
    const store = new CachedFoldStore(inner, cache, {
      keyPrefix: "trace_summaries",
      ttlSeconds: 3_600,
    });
    return { store, cache, inner, findByTraceIdWithVersion };
  }

  describe("given the store declares the version its rows carry", () => {
    it("scopes the cache key by that version", async () => {
      const { store, cache, inner } = cachedStore();

      await store.store({ traceId: "trace-1", spanCount: 1 } as any, context);

      const keys = [...cache.entries.keys()];
      expect(keys).toEqual([
        `fold:trace_summaries:${inner.projectionVersion}:project-1:trace-1`,
      ]);
    });
  });

  describe("given a cache entry written under a different version's key", () => {
    it("misses and falls through to the repository", async () => {
      const { store, cache, findByTraceIdWithVersion } = cachedStore();
      await cache.write(
        "fold:trace_summaries:2020-01-01:project-1:trace-1",
        JSON.stringify({ traceId: "trace-1", spanCount: 99 }),
        3_600,
      );

      const result = await store.get("trace-1", context);

      expect(result).toBeNull();
      expect(findByTraceIdWithVersion).toHaveBeenCalledTimes(1);
    });
  });
});
