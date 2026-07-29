import { register } from "prom-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTenantId } from "../../domain/tenantId";
import { CachedFoldStore } from "../cachedFoldStore";
import { InMemoryFoldCacheClient } from "../foldCache/foldCacheClient";
import type { FoldProjectionStore } from "../foldProjection.types";
import type { ProjectionStoreContext } from "../projectionStoreContext";

// Capture the wrapper's own logger so the TTL-floor clamp can be asserted to
// warn (once), while leaving every other observability export intact.
const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }));
vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@langwatch/observability")>();
  return {
    ...actual,
    createLogger: () => ({
      warn: warnSpy,
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

interface TestState {
  count: number;
  UpdatedAt: number;
}

function createInnerStore(
  durable: TestState | null = { count: 1, UpdatedAt: 100 },
) {
  const calls = {
    get: [] as string[],
    store: [] as TestState[],
  };

  const store: FoldProjectionStore<TestState> = {
    async get(aggregateId: string) {
      calls.get.push(aggregateId);
      return durable;
    },
    async store(state: TestState) {
      calls.store.push(state);
    },
  };

  return { store, calls };
}

/**
 * An inner store that persists the applied-event-id set next to its state —
 * the durable read-back shape (`getWithApplied`) a store gains under ADR-066.
 * Its `get()` still answers state-only, so the wrapper's cache-miss path is
 * exercised for both entry points.
 */
function createDurableInnerStore({
  state = { count: 1, UpdatedAt: 100 },
  appliedEventIds,
}: {
  state?: TestState | null;
  appliedEventIds: string[];
}) {
  const calls = { get: [] as string[], getWithApplied: [] as string[] };
  const store: FoldProjectionStore<TestState> = {
    async get(aggregateId: string) {
      calls.get.push(aggregateId);
      return state;
    },
    async getWithApplied(aggregateId: string) {
      calls.getWithApplied.push(aggregateId);
      return { state, appliedEventIds };
    },
    async store() {},
  };
  return { store, calls };
}

/**
 * Reads the dedup-unavailable counter straight off the registry for the
 * `test_table` projection — a spy on a destructured copy would intercept
 * nothing and pass regardless.
 */
async function dedupUnavailableCount(reason: string): Promise<number> {
  const metric = await register
    .getSingleMetric("es_fold_dedup_unavailable_total")
    ?.get();
  return (
    metric?.values.find(
      (v) =>
        v.labels.projection_name === "test_table" && v.labels.reason === reason,
    )?.value ?? 0
  );
}

/**
 * The cache tier as the store sees it. A spied `InMemoryFoldCacheClient` — the
 * real implementation, so the assertions below are about the store's behaviour
 * and not about a double's.
 */
function createCache() {
  const client = new InMemoryFoldCacheClient();
  return {
    values: client.entries,
    read: vi.spyOn(client, "read"),
    write: vi.spyOn(client, "write"),
    client,
  };
}

/**
 * The TTL the store handed the cache tier on its last write. Read off the
 * `write` call rather than off the entry the client kept, because the TTL the
 * store resolves is what this file is asserting about — how the client then
 * chooses to represent expiry is the client's business.
 */
function ttlPassedToCache(cache: ReturnType<typeof createCache>) {
  return cache.write.mock.calls.at(-1)?.[2];
}

/**
 * The same store, declaring the schema version it reads and writes — what an
 * ADR-066 read-back store publishes so the tier in front of it can key by it.
 */
function versioned(
  store: FoldProjectionStore<TestState>,
  projectionVersion: string,
): FoldProjectionStore<TestState> {
  return { ...store, projectionVersion };
}

const TENANT = createTenantId("tenant-1");
const CONTEXT: ProjectionStoreContext = {
  aggregateId: "agg-1",
  tenantId: TENANT,
};
const CACHE_KEY = `fold:test_table:${String(TENANT)}:agg-1`;

function createStore<
  Inner extends { store: FoldProjectionStore<TestState> } = ReturnType<
    typeof createInnerStore
  >,
>(
  cache: ReturnType<typeof createCache>,
  inner: Inner = createInnerStore() as unknown as Inner,
) {
  return {
    inner,
    store: new CachedFoldStore<TestState>(inner.store, cache.client, {
      keyPrefix: "test_table",
      ttlSeconds: 3_600,
    }),
  };
}

describe("CachedFoldStore", () => {
  describe("given a cached entry", () => {
    describe("when the fold reads state", () => {
      /** @scenario "A cached entry is served without reading the durable store" */
      it("returns the cached state without reading the durable store", async () => {
        const redis = createCache();
        const { store, inner } = createStore(redis);

        await store.store({ count: 5, UpdatedAt: 200 }, CONTEXT);
        const result = await store.get("agg-1", CONTEXT);

        expect(result).toEqual({ count: 5, UpdatedAt: 200 });
        expect(inner.calls.get).toHaveLength(0);
      });
    });
  });

  describe("given no cached entry", () => {
    describe("when the fold reads state", () => {
      /** @scenario a cold cache recovers state from the store, not the event log */
      /** @scenario "A miss reads the durable store" */
      it("reads the durable store, which confirmation proves authoritative", async () => {
        const redis = createCache();
        const { store, inner } = createStore(redis);

        const result = await store.get("agg-1", CONTEXT);

        expect(result).toEqual({ count: 1, UpdatedAt: 100 });
        expect(inner.calls.get).toEqual(["agg-1"]);
      });
    });
  });

  describe("given a context carrying bypassReadCache", () => {
    describe("when the executor's read-window fallback re-reads", () => {
      it("goes straight to the durable tier without touching Redis", async () => {
        const redis = createCache();
        const { store, inner } = createStore(redis);
        // A cached entry exists — the bypass must skip it anyway: the retry
        // only happens because the windowed attempt just consulted the cache.
        await store.store({ count: 5, UpdatedAt: 200 }, CONTEXT);
        redis.read.mockClear();

        const result = await store.get("agg-1", {
          ...CONTEXT,
          bypassReadCache: true,
        });

        expect(redis.read).not.toHaveBeenCalled();
        expect(result).toEqual({ count: 1, UpdatedAt: 100 });
        expect(inner.calls.get).toEqual(["agg-1"]);
      });
    });
  });

  describe("given Redis is unreachable", () => {
    describe("when the fold reads state", () => {
      /** @scenario "A corrupt cached entry is treated as a miss" */
      it("falls through to the durable store rather than failing the fold", async () => {
        const redis = createCache();
        redis.read.mockRejectedValueOnce(new Error("connection lost"));
        const { store, inner } = createStore(redis);

        const result = await store.get("agg-1", CONTEXT);

        expect(result).toEqual({ count: 1, UpdatedAt: 100 });
        expect(inner.calls.get).toEqual(["agg-1"]);
      });
    });
  });

  describe("when the fold stores state", () => {
    it("writes the durable store before caching", async () => {
      const redis = createCache();
      const { store, inner } = createStore(redis);

      await store.store({ count: 5, UpdatedAt: 200 }, CONTEXT);

      expect(inner.calls.store).toEqual([{ count: 5, UpdatedAt: 200 }]);
      expect(redis.values.has(CACHE_KEY)).toBe(true);
    });

    it("caches under the configured TTL", async () => {
      const redis = createCache();
      const { store } = createStore(redis);

      await store.store({ count: 5, UpdatedAt: 200 }, CONTEXT);

      expect(ttlPassedToCache(redis)).toBe(3_600);
    });

    it("records the state version so confirmation has something to compare", async () => {
      const redis = createCache();
      const { store } = createStore(redis);

      await store.store({ count: 5, UpdatedAt: 200 }, CONTEXT);

      const entry = JSON.parse(redis.values.get(CACHE_KEY)!.value);
      expect(entry.u).toBe(200);
    });
  });

  // A cache HIT returns before the durable read, so the durable store's
  // version gate — and `FoldProjectionExecutor.assertUndecodableIsRecoverable`
  // behind it — never runs on that path. Unless the version is part of the key,
  // a build that changed the state shape reads the PREVIOUS shape out of the
  // cache, folds onto it, and commits the result stamped at the current
  // version, laundering it past the gate that exists to reject it.
  describe("given the wrapped store declares a projection version", () => {
    describe("when the version changes", () => {
      it("misses, so the read reaches the durable store's version gate", async () => {
        const redis = createCache();
        await new CachedFoldStore<TestState>(
          versioned(createInnerStore().store, "2026-07-01"),
          redis.client,
          { keyPrefix: "test_table" },
        ).store({ count: 5, UpdatedAt: 200 }, CONTEXT);

        const inner = createInnerStore();
        const result = await new CachedFoldStore<TestState>(
          versioned(inner.store, "2026-07-28"),
          redis.client,
          { keyPrefix: "test_table" },
        ).get("agg-1", CONTEXT);

        expect(inner.calls.get).toEqual(["agg-1"]);
        expect(result).toEqual({ count: 1, UpdatedAt: 100 });
      });

      /**
       * The rotation is what the version key COSTS, and it is deliberate: the
       * previous version's entry is still live — a reader on that version is
       * served from it — and the new version passes it over anyway. So a miss
       * after a version change carries none of the settling the TTL contract
       * infers from an ordinary miss: the write behind it may be seconds old,
       * and the durable read that answers instead may be a lagging replica.
       * Pinned here because it is the one deploy-time correctness cost of
       * keying by version, and it is paid on purpose.
       *
       * @scenario state cached under an older shape is passed over even while it is still warm
       */
      it("passes over the previous version's live entry rather than waiting for it to expire", async () => {
        const redis = createCache();
        const previous = new CachedFoldStore<TestState>(
          versioned(createInnerStore().store, "2026-07-01"),
          redis.client,
          { keyPrefix: "test_table" },
        );
        await previous.store({ count: 5, UpdatedAt: 200 }, CONTEXT);

        // The durable tier answers with older state, which is what a replica
        // that has not caught up with that write looks like.
        const inner = createInnerStore({ count: 1, UpdatedAt: 100 });
        const current = new CachedFoldStore<TestState>(
          versioned(inner.store, "2026-07-28"),
          redis.client,
          { keyPrefix: "test_table" },
        );

        const afterChange = await current.get("agg-1", CONTEXT);
        const stillWarm = await previous.get("agg-1", CONTEXT);

        expect(afterChange).toEqual({ count: 1, UpdatedAt: 100 });
        expect(stillWarm).toEqual({ count: 5, UpdatedAt: 200 });
        expect(inner.calls.get).toEqual(["agg-1"]);
      });
    });

    // The same fold is composed in more than one place — the pipeline writes
    // `trace_summaries`, the automation settle confirm reads it through the same
    // cache tier precisely so it reads what that writer wrote. Taking the
    // version off the store rather than off each composition site is what stops
    // those two drifting apart and splitting the key space in silence.
    describe("when a separately composed reader wraps the same store", () => {
      it("hits the entry the writer wrote", async () => {
        const redis = createCache();
        await new CachedFoldStore<TestState>(
          versioned(createInnerStore().store, "2026-07-28"),
          redis.client,
          { keyPrefix: "test_table" },
        ).store({ count: 5, UpdatedAt: 200 }, CONTEXT);

        const reader = createInnerStore();
        const result = await new CachedFoldStore<TestState>(
          versioned(reader.store, "2026-07-28"),
          redis.client,
          { keyPrefix: "test_table" },
        ).get("agg-1", CONTEXT);

        expect(result).toEqual({ count: 5, UpdatedAt: 200 });
        expect(reader.calls.get).toHaveLength(0);
      });
    });
  });

  describe("given a store that declares no projection version", () => {
    describe("when state is written and read back", () => {
      it("keeps its entries, so an unversioned fold's keys do not move", async () => {
        const redis = createCache();
        const inner = createInnerStore();
        const store = new CachedFoldStore<TestState>(
          inner.store,
          redis.client,
          { keyPrefix: "test_table" },
        );

        await store.store({ count: 5, UpdatedAt: 200 }, CONTEXT);
        const result = await store.get("agg-1", CONTEXT);

        expect(result).toEqual({ count: 5, UpdatedAt: 200 });
        expect(redis.values.has(CACHE_KEY)).toBe(true);
      });
    });
  });

  describe("given the durable write succeeded but caching fails", () => {
    describe("when the fold stores state", () => {
      it("does not fail the fold, because the state is already durable", async () => {
        const redis = createCache();
        redis.write.mockRejectedValueOnce(new Error("OOM"));
        const { store, inner } = createStore(redis);

        await expect(
          store.store({ count: 5, UpdatedAt: 200 }, CONTEXT),
        ).resolves.toBeUndefined();
        expect(inner.calls.store).toHaveLength(1);
      });
    });
  });

  // Since ADR-066 the executor (`FoldProjectionExecutor.appliedIdsForCommit`)
  // decides the applied-event-id set at commit — union on a retry, reset on a
  // fresh delivery — and stamps it on the context. This tier is a dumb
  // read/write cache: it persists that set verbatim and no longer re-reads the
  // cache to re-merge, so a store issues no Redis GET.
  describe("given the context carries an applied-event-id set", () => {
    describe("when the state is stored", () => {
      it("persists the set verbatim so a redelivery can be recognised", async () => {
        const redis = createCache();
        const { store } = createStore(redis);

        await store.store(
          { count: 5, UpdatedAt: 200 },
          { ...CONTEXT, appliedEventIds: ["e1", "e2"] },
        );

        const cached = await store.getWithApplied("agg-1", CONTEXT);
        expect(cached?.appliedEventIds).toEqual(["e1", "e2"]);
      });

      it("does not re-read the cache to re-merge, even on a retry", async () => {
        const redis = createCache();
        const { store } = createStore(redis);

        // The executor has already merged the retry's set into the context; the
        // wrapper must persist it as given and issue no GET of its own (the
        // redundant read-back ADR-066 removed).
        await store.store(
          { count: 6, UpdatedAt: 201 },
          { ...CONTEXT, appliedEventIds: ["e1", "e2"], deliveryAttempt: 2 },
        );

        expect(redis.read).not.toHaveBeenCalled();
        expect(redis.write).toHaveBeenCalledTimes(1);

        const cached = await store.getWithApplied("agg-1", CONTEXT);
        expect(cached?.appliedEventIds).toEqual(["e1", "e2"]);
      });

      it("records an empty set when the context carries none", async () => {
        const redis = createCache();
        const { store } = createStore(redis);

        // The replay path stores without stamping a set; absent is persisted as
        // empty, matching that path's prior result.
        await store.store({ count: 5, UpdatedAt: 200 }, CONTEXT);

        const cached = await store.getWithApplied("agg-1", CONTEXT);
        expect(cached?.appliedEventIds).toEqual([]);
      });
    });
  });

  describe("given an entry written before durability gating", () => {
    describe("when the fold reads state", () => {
      it("still returns the state, carrying no applied events", async () => {
        const redis = createCache();
        const { store } = createStore(redis);
        redis.values.set(CACHE_KEY, {
          value: JSON.stringify({ count: 9, UpdatedAt: 300 }),
          expiresAt: Date.now() + 300_000,
        });

        const cached = await store.getWithApplied("agg-1", CONTEXT);

        expect(cached?.state).toEqual({ count: 9, UpdatedAt: 300 });
        expect(cached?.appliedEventIds).toEqual([]);
      });
    });
  });

  describe("given a retry whose applied-set is gone", () => {
    /** @scenario "A corrupt cached entry is treated as a miss" */
    it("counts it, because the batch is about to be re-applied on top of itself", async () => {
      // The dangerous case is invisible in the existing signals: a miss on a
      // retry and a miss on a fresh delivery are the same observation, and the
      // duplicate-skipped counter staying flat reads as good news whether dedup
      // was idle or blind.
      const before = await dedupUnavailableCount("cache_miss");

      const redis = createCache();
      const { store } = createStore(redis);
      const result = await store.getWithApplied("agg-1", {
        ...CONTEXT,
        deliveryAttempt: 3,
      });

      expect(result.appliedEventIds).toEqual([]);
      expect(await dedupUnavailableCount("cache_miss")).toBe(before + 1);
    });

    it("does not count a fresh delivery, where a miss is unremarkable", async () => {
      const before = await dedupUnavailableCount("cache_miss");

      const redis = createCache();
      const { store } = createStore(redis);
      await store.getWithApplied("agg-1", { ...CONTEXT, deliveryAttempt: 1 });

      expect(await dedupUnavailableCount("cache_miss")).toBe(before);
    });
  });

  describe("given an inner store that persists the applied-set durably", () => {
    describe("when a retry misses the cache and the durable set has ids", () => {
      /** @scenario a redelivered batch after a committed write does not double-count */
      it("returns the durable set and does not count dedup unavailable", async () => {
        const before = await dedupUnavailableCount("cache_miss");

        const redis = createCache();
        const inner = createDurableInnerStore({
          appliedEventIds: ["e1", "e2"],
        });
        const { store } = createStore(redis, inner);

        const result = await store.getWithApplied("agg-1", {
          ...CONTEXT,
          deliveryAttempt: 2,
        });

        // The durable row answered the redelivery, so dedup was available.
        expect(result.state).toEqual({ count: 1, UpdatedAt: 100 });
        expect(result.appliedEventIds).toEqual(["e1", "e2"]);
        expect(inner.calls.getWithApplied).toEqual(["agg-1"]);
        expect(await dedupUnavailableCount("cache_miss")).toBe(before);
      });
    });

    describe("when a retry misses the cache and the durable set is empty", () => {
      it("still counts dedup unavailable, preserving the blind-reapply signal", async () => {
        const before = await dedupUnavailableCount("cache_miss");

        const redis = createCache();
        const inner = createDurableInnerStore({ appliedEventIds: [] });
        const { store } = createStore(redis, inner);

        const result = await store.getWithApplied("agg-1", {
          ...CONTEXT,
          deliveryAttempt: 2,
        });

        expect(result.appliedEventIds).toEqual([]);
        expect(await dedupUnavailableCount("cache_miss")).toBe(before + 1);
      });
    });
  });

  // The TTL is a correctness invariant (ADR-066): a cache miss is authoritative
  // only because the entry has outlived the ClickHouse replication lag, so an
  // operator override must never take it below the floor. `resolveFoldCacheTtl`
  // runs at construction; a fresh module is loaded per case so the once-per-
  // process clamp warning can be observed.
  describe("given LANGWATCH_FOLD_CACHE_TTL_SECONDS", () => {
    const ENV = "LANGWATCH_FOLD_CACHE_TTL_SECONDS";
    let original: string | undefined;

    beforeEach(() => {
      original = process.env[ENV];
      warnSpy.mockClear();
      vi.resetModules();
    });

    afterEach(() => {
      if (original === undefined) delete process.env[ENV];
      else process.env[ENV] = original;
    });

    async function freshStore(redis: ReturnType<typeof createCache>) {
      const { CachedFoldStore: Fresh } = await import("../cachedFoldStore");
      return new Fresh<TestState>(createInnerStore().store, redis.client, {
        keyPrefix: "test_table",
      });
    }

    async function ttlWrittenBy(redis: ReturnType<typeof createCache>) {
      const store = await freshStore(redis);
      await store.store({ count: 1, UpdatedAt: 1 }, CONTEXT);
      return ttlPassedToCache(redis);
    }

    describe("when the override is below the replication-lag floor", () => {
      it("clamps the effective TTL up to the floor and warns", async () => {
        process.env[ENV] = "60";
        const redis = createCache();

        // The write lands at the floor, not the configured 60 — the clamp acted.
        expect(await ttlWrittenBy(redis)).toBe(300);
        expect(warnSpy).toHaveBeenCalledTimes(1);
      });

      it("warns only once even when several stores resolve a clamped TTL", async () => {
        process.env[ENV] = "30";
        const { CachedFoldStore: Fresh } = await import("../cachedFoldStore");

        new Fresh<TestState>(createInnerStore().store, createCache().client, {
          keyPrefix: "test_table",
        });
        new Fresh<TestState>(createInnerStore().store, createCache().client, {
          keyPrefix: "test_table",
        });

        expect(warnSpy).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the override is above the floor", () => {
      it("honours the configured value and does not warn", async () => {
        process.env[ENV] = "600";
        const redis = createCache();

        // Above the floor is passed through untouched — the override is respected.
        expect(await ttlWrittenBy(redis)).toBe(600);
        expect(warnSpy).not.toHaveBeenCalled();
      });
    });

    describe("when the override is unset", () => {
      it("falls back to the default without warning", async () => {
        delete process.env[ENV];
        const redis = createCache();

        expect(await ttlWrittenBy(redis)).toBe(300);
        expect(warnSpy).not.toHaveBeenCalled();
      });
    });
  });
});
