import { Cluster, Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";
import { CachedFoldStore } from "../../cachedFoldStore";
import { createTenantId } from "../../../domain/tenantId";
import type { FoldProjectionStore } from "../../foldProjection.types";
import type { ProjectionStoreContext } from "../../projectionStoreContext";
import {
  type FoldCacheClient,
  InMemoryFoldCacheClient,
  RedisFoldCacheClient,
} from "../foldCacheClient";

interface TraceSummaryish {
  spanCount: number;
  UpdatedAt: number;
}

const TENANT = createTenantId("project-1");
const CONTEXT: ProjectionStoreContext = {
  aggregateId: "trace-1",
  tenantId: TENANT,
};

/**
 * A durable store that records its own reads, so "served from the cache tier"
 * is observable rather than inferred.
 */
function createDurableStore() {
  const reads: string[] = [];
  let current: TraceSummaryish | null = null;

  const store: FoldProjectionStore<TraceSummaryish> = {
    async get(aggregateId) {
      reads.push(aggregateId);
      return current;
    },
    async store(next) {
      current = next;
    },
  };

  return { store, reads };
}

describe("RedisFoldCacheClient", () => {
  describe("given a standalone client", () => {
    describe("when the fold cache reads and writes", () => {
      it("issues one single-key GET and one single-key SET with the TTL", async () => {
        const redis = new Redis({ lazyConnect: true });
        const entries = new Map<string, string>();
        const get = vi
          .spyOn(redis, "get")
          .mockImplementation(async (key) => entries.get(String(key)) ?? null);
        const set = vi
          .spyOn(redis, "set")
          .mockImplementation(async (key, value) => {
            entries.set(String(key), String(value));
            return "OK";
          });
        const client = new RedisFoldCacheClient(redis);

        await client.write("fold:k", "payload", 300);
        const read = await client.read("fold:k");

        expect(read).toBe("payload");
        expect(set).toHaveBeenCalledWith("fold:k", "payload", "EX", 300);
        expect(get).toHaveBeenCalledWith("fold:k");
      });
    });
  });

  describe("given a Cluster client", () => {
    /**
     * The behaviour change this port carries. The registry used to reach a
     * Cluster client through `as Redis` and cache anyway; automation dispatch
     * checked `instanceof Cluster` and fell back to the uncached store. Neither
     * branch exists now: single-key GET/SET route to the owning slot, so a
     * Cluster deployment keeps ADR-066 §5's read-your-write layer rather than
     * quietly losing it.
     */
    describe("when the fold cache reads and writes", () => {
      it("caches through the cluster rather than degrading to the durable store", async () => {
        const cluster = new Cluster([{ host: "127.0.0.1", port: 7000 }], {
          lazyConnect: true,
        });
        const entries = new Map<string, string>();
        vi.spyOn(cluster, "get").mockImplementation(
          async (key) => entries.get(String(key)) ?? null,
        );
        vi.spyOn(cluster, "set").mockImplementation(async (key, value) => {
          entries.set(String(key), String(value));
          return "OK";
        });

        const durable = createDurableStore();
        const store = new CachedFoldStore<TraceSummaryish>(
          durable.store,
          new RedisFoldCacheClient(cluster),
          { keyPrefix: "trace_summaries" },
        );

        await store.store({ spanCount: 3, UpdatedAt: 10 }, CONTEXT);
        const read = await store.get("trace-1", CONTEXT);

        expect(read).toEqual({ spanCount: 3, UpdatedAt: 10 });
        expect(durable.reads).toEqual([]);
      });
    });
  });
});

describe("InMemoryFoldCacheClient", () => {
  describe("given a process running without Redis", () => {
    describe("when the fold cache reads and writes", () => {
      it("keeps read-your-write within the process", async () => {
        const durable = createDurableStore();
        const store = new CachedFoldStore<TraceSummaryish>(
          durable.store,
          new InMemoryFoldCacheClient(),
          { keyPrefix: "trace_summaries" },
        );

        await store.store({ spanCount: 3, UpdatedAt: 10 }, CONTEXT);
        const read = await store.get("trace-1", CONTEXT);

        expect(read).toEqual({ spanCount: 3, UpdatedAt: 10 });
        expect(durable.reads).toEqual([]);
      });

      it("serves the entry while it is inside its TTL", async () => {
        vi.useFakeTimers();
        try {
          const client = new InMemoryFoldCacheClient();

          await client.write("fold:k", "payload", 300);
          vi.advanceTimersByTime(299_000);

          expect(await client.read("fold:k")).toBe("payload");
        } finally {
          vi.useRealTimers();
        }
      });
    });

    /**
     * The TTL is a correctness invariant, not housekeeping (ADR-066 §5): a
     * miss is authoritative because it means the last write is at least a TTL
     * old and has therefore settled. A tier that never expires would hand dev
     * and every integration run a cache that never falls through to the
     * store's ClickHouse read-back, and a `Map` that grows for the process
     * lifetime.
     */
    describe("when an entry is read after its TTL has passed", () => {
      it("misses, so the read falls through to the durable store", async () => {
        vi.useFakeTimers();
        try {
          const durable = createDurableStore();
          const client = new InMemoryFoldCacheClient();
          const store = new CachedFoldStore<TraceSummaryish>(
            durable.store,
            client,
            { keyPrefix: "trace_summaries", ttlSeconds: 300 },
          );

          await store.store({ spanCount: 3, UpdatedAt: 10 }, CONTEXT);
          vi.advanceTimersByTime(301_000);
          const read = await store.get("trace-1", CONTEXT);

          expect(read).toEqual({ spanCount: 3, UpdatedAt: 10 });
          expect(durable.reads).toEqual(["trace-1"]);
        } finally {
          vi.useRealTimers();
        }
      });

      it("drops the expired entry rather than holding it for the process lifetime", async () => {
        vi.useFakeTimers();
        try {
          const client = new InMemoryFoldCacheClient();

          await client.write("fold:k", "payload", 300);
          vi.advanceTimersByTime(301_000);
          await client.read("fold:k");

          expect(client.entries.has("fold:k")).toBe(false);
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });
});

describe("the two composition sites that share trace_summaries", () => {
  /**
   * The trace pipeline WRITES trace_summaries; automation dispatch re-READS it
   * for the settle confirm. Each composes its own `TraceSummaryStore` over its
   * own repository handle, so the only thing making them one store is a shared
   * cache client and a matching key prefix. Under Cluster they used to
   * disagree — the writer cached, the reader did not — which is exactly the
   * divergence a single client makes unrepresentable.
   */
  describe("when the writer's site stores and the reader's site reads", () => {
    it("serves the reader the entry the writer wrote", async () => {
      const client: FoldCacheClient = new InMemoryFoldCacheClient();
      const writerDurable = createDurableStore();
      const readerDurable = createDurableStore();

      const writerSite = new CachedFoldStore<TraceSummaryish>(
        writerDurable.store,
        client,
        { keyPrefix: "trace_summaries" },
      );
      const readerSite = new CachedFoldStore<TraceSummaryish>(
        readerDurable.store,
        client,
        { keyPrefix: "trace_summaries" },
      );

      await writerSite.store({ spanCount: 7, UpdatedAt: 20 }, CONTEXT);
      const read = await readerSite.get("trace-1", CONTEXT);

      expect(read).toEqual({ spanCount: 7, UpdatedAt: 20 });
      expect(readerDurable.reads).toEqual([]);
    });

    it("agrees on the cache key, so neither can silently miss the other", async () => {
      const client = new InMemoryFoldCacheClient();

      await new CachedFoldStore<TraceSummaryish>(
        createDurableStore().store,
        client,
        { keyPrefix: "trace_summaries" },
      ).store({ spanCount: 1, UpdatedAt: 10 }, CONTEXT);

      expect([...client.entries.keys()]).toEqual([
        `fold:trace_summaries:${String(TENANT)}:trace-1`,
      ]);
    });
  });
});
