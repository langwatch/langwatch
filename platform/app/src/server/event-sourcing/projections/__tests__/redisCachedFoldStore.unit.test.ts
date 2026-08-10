import { register } from "prom-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTenantId } from "../../domain/tenantId";
import type { FoldProjectionStore } from "../foldProjection.types";
import type { ProjectionStoreContext } from "../projectionStoreContext";
import { RedisCachedFoldStore } from "../redisCachedFoldStore";

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

/** The cache-outcome counter for `test_table`, read off the registry too. */
async function cacheTotalCount(result: string): Promise<number> {
  const metric = await register.getSingleMetric("es_fold_cache_total")?.get();
  return (
    metric?.values.find(
      (v) =>
        v.labels.projection_name === "test_table" && v.labels.result === result,
    )?.value ?? 0
  );
}

function createRedis() {
  const values = new Map<string, { value: string; ttlSeconds: number }>();

  return {
    values,
    get: vi.fn(async (key: string) => values.get(key)?.value ?? null),
    set: vi.fn(
      async (key: string, value: string, _mode: string, ttlSeconds: number) => {
        values.set(key, { value, ttlSeconds });
        return "OK";
      },
    ),
  };
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
  redis: ReturnType<typeof createRedis>,
  inner: Inner = createInnerStore() as unknown as Inner,
) {
  return {
    inner,
    store: new RedisCachedFoldStore<TestState>(inner.store, redis as never, {
      keyPrefix: "test_table",
      ttlSeconds: 3_600,
    }),
  };
}

describe("RedisCachedFoldStore", () => {
  describe("given a cached entry", () => {
    describe("when the fold reads state", () => {
      it("returns the cached state without reading the durable store", async () => {
        const redis = createRedis();
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
      it("reads the durable store, which confirmation proves authoritative", async () => {
        const redis = createRedis();
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
        const redis = createRedis();
        const { store, inner } = createStore(redis);
        // A cached entry exists — the bypass must skip it anyway: the retry
        // only happens because the windowed attempt just consulted the cache.
        await store.store({ count: 5, UpdatedAt: 200 }, CONTEXT);
        redis.get.mockClear();

        const result = await store.get("agg-1", {
          ...CONTEXT,
          bypassReadCache: true,
        });

        expect(redis.get).not.toHaveBeenCalled();
        expect(result).toEqual({ count: 1, UpdatedAt: 100 });
        expect(inner.calls.get).toEqual(["agg-1"]);
      });
    });
  });

  describe("given Redis is unreachable", () => {
    describe("when the fold reads state", () => {
      /** @scenario an unreadable fold cache is answered from the durable store, and counted apart from a miss */
      it("falls through to the durable store rather than failing the fold", async () => {
        const before = await cacheTotalCount("fallback_error");
        const missesBefore = await cacheTotalCount("miss");
        const redis = createRedis();
        redis.get.mockRejectedValueOnce(new Error("connection lost"));
        const { store, inner } = createStore(redis);

        const result = await store.get("agg-1", CONTEXT);

        expect(result).toEqual({ count: 1, UpdatedAt: 100 });
        expect(inner.calls.get).toEqual(["agg-1"]);
        // Counted as its own outcome, never as an ordinary miss. A miss means
        // the last write is at least a TTL old and has therefore settled
        // across the replicas, which is what makes the durable read
        // authoritative. A failed read means nothing of the kind, so the two
        // must stay tellable apart from the outside.
        expect(await cacheTotalCount("fallback_error")).toBe(before + 1);
        expect(await cacheTotalCount("miss")).toBe(missesBefore);
      });
    });
  });

  describe("when the fold stores state", () => {
    it("writes the durable store before caching", async () => {
      const redis = createRedis();
      const { store, inner } = createStore(redis);

      await store.store({ count: 5, UpdatedAt: 200 }, CONTEXT);

      expect(inner.calls.store).toEqual([{ count: 5, UpdatedAt: 200 }]);
      expect(redis.values.has(CACHE_KEY)).toBe(true);
    });

    it("caches under the configured TTL", async () => {
      const redis = createRedis();
      const { store } = createStore(redis);

      await store.store({ count: 5, UpdatedAt: 200 }, CONTEXT);

      expect(redis.values.get(CACHE_KEY)?.ttlSeconds).toBe(3_600);
    });

    it("records the state version so confirmation has something to compare", async () => {
      const redis = createRedis();
      const { store } = createStore(redis);

      await store.store({ count: 5, UpdatedAt: 200 }, CONTEXT);

      const entry = JSON.parse(redis.values.get(CACHE_KEY)!.value);
      expect(entry.u).toBe(200);
    });
  });

  describe("given the durable write succeeded but caching fails", () => {
    describe("when the fold stores state", () => {
      it("does not fail the fold, because the state is already durable", async () => {
        const redis = createRedis();
        redis.set.mockRejectedValueOnce(new Error("OOM"));
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
        const redis = createRedis();
        const { store } = createStore(redis);

        await store.store(
          { count: 5, UpdatedAt: 200 },
          { ...CONTEXT, appliedEventIds: ["e1", "e2"] },
        );

        const cached = await store.getWithApplied("agg-1", CONTEXT);
        expect(cached?.appliedEventIds).toEqual(["e1", "e2"]);
      });

      it("does not re-read the cache to re-merge, even on a retry", async () => {
        const redis = createRedis();
        const { store } = createStore(redis);

        // The executor has already merged the retry's set into the context; the
        // wrapper must persist it as given and issue no GET of its own (the
        // redundant read-back ADR-066 removed).
        await store.store(
          { count: 6, UpdatedAt: 201 },
          { ...CONTEXT, appliedEventIds: ["e1", "e2"], deliveryAttempt: 2 },
        );

        expect(redis.get).not.toHaveBeenCalled();
        expect(redis.set).toHaveBeenCalledTimes(1);

        const cached = await store.getWithApplied("agg-1", CONTEXT);
        expect(cached?.appliedEventIds).toEqual(["e1", "e2"]);
      });

      it("records an empty set when the context carries none", async () => {
        const redis = createRedis();
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
        const redis = createRedis();
        const { store } = createStore(redis);
        redis.values.set(CACHE_KEY, {
          value: JSON.stringify({ count: 9, UpdatedAt: 300 }),
          ttlSeconds: 300,
        });

        const cached = await store.getWithApplied("agg-1", CONTEXT);

        expect(cached?.state).toEqual({ count: 9, UpdatedAt: 300 });
        expect(cached?.appliedEventIds).toEqual([]);
      });
    });
  });

  describe("given a retry whose applied-set is gone", () => {
    it("counts it, because the batch is about to be re-applied on top of itself", async () => {
      // The dangerous case is invisible in the existing signals: a miss on a
      // retry and a miss on a fresh delivery are the same observation, and the
      // duplicate-skipped counter staying flat reads as good news whether dedup
      // was idle or blind.
      const before = await dedupUnavailableCount("cache_miss");

      const redis = createRedis();
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

      const redis = createRedis();
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

        const redis = createRedis();
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

        const redis = createRedis();
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

    async function freshStore(redis: ReturnType<typeof createRedis>) {
      const { RedisCachedFoldStore: Fresh } = await import(
        "../redisCachedFoldStore"
      );
      return new Fresh<TestState>(createInnerStore().store, redis as never, {
        keyPrefix: "test_table",
      });
    }

    async function ttlWrittenBy(redis: ReturnType<typeof createRedis>) {
      const store = await freshStore(redis);
      await store.store({ count: 1, UpdatedAt: 1 }, CONTEXT);
      return redis.values.get(CACHE_KEY)?.ttlSeconds;
    }

    describe("when the override is below the replication-lag floor", () => {
      it("clamps the effective TTL up to the floor and warns", async () => {
        process.env[ENV] = "60";
        const redis = createRedis();

        // The write lands at the floor, not the configured 60 — the clamp acted.
        expect(await ttlWrittenBy(redis)).toBe(300);
        expect(warnSpy).toHaveBeenCalledTimes(1);
      });

      it("warns only once even when several stores resolve a clamped TTL", async () => {
        process.env[ENV] = "30";
        const { RedisCachedFoldStore: Fresh } = await import(
          "../redisCachedFoldStore"
        );

        new Fresh<TestState>(createInnerStore().store, createRedis() as never, {
          keyPrefix: "test_table",
        });
        new Fresh<TestState>(createInnerStore().store, createRedis() as never, {
          keyPrefix: "test_table",
        });

        expect(warnSpy).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the override is above the floor", () => {
      it("honours the configured value and does not warn", async () => {
        process.env[ENV] = "600";
        const redis = createRedis();

        // Above the floor is passed through untouched — the override is respected.
        expect(await ttlWrittenBy(redis)).toBe(600);
        expect(warnSpy).not.toHaveBeenCalled();
      });
    });

    describe("when the override is unset", () => {
      it("falls back to the default without warning", async () => {
        delete process.env[ENV];
        const redis = createRedis();

        expect(await ttlWrittenBy(redis)).toBe(300);
        expect(warnSpy).not.toHaveBeenCalled();
      });
    });
  });
});
