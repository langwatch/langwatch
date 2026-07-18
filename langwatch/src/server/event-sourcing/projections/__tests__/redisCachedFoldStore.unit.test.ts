import { describe, expect, it, vi } from "vitest";
import { createTenantId } from "../../domain/tenantId";
import type { FoldProjectionStore } from "../foldProjection.types";
import type { ProjectionStoreContext } from "../projectionStoreContext";
import { RedisCachedFoldStore } from "../redisCachedFoldStore";

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

function createStore(
  redis: ReturnType<typeof createRedis>,
  inner = createInnerStore(),
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
      it("reads the durable store, which confirmation proves authoritative", async () => {
        const redis = createRedis();
        const { store, inner } = createStore(redis);

        const result = await store.get("agg-1", CONTEXT);

        expect(result).toEqual({ count: 1, UpdatedAt: 100 });
        expect(inner.calls.get).toEqual(["agg-1"]);
      });
    });
  });

  describe("given Redis is unreachable", () => {
    describe("when the fold reads state", () => {
      it("falls through to the durable store rather than failing the fold", async () => {
        const redis = createRedis();
        redis.get.mockRejectedValueOnce(new Error("connection lost"));
        const { store, inner } = createStore(redis);

        const result = await store.get("agg-1", CONTEXT);

        expect(result).toEqual({ count: 1, UpdatedAt: 100 });
        expect(inner.calls.get).toEqual(["agg-1"]);
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

  describe("given a fold applied events", () => {
    describe("when the state is stored", () => {
      it("records their ids so a redelivery can be recognised", async () => {
        const redis = createRedis();
        const { store } = createStore(redis);

        await store.store(
          { count: 5, UpdatedAt: 200 },
          { ...CONTEXT, appliedEventIds: ["e1", "e2"] },
        );

        const cached = await store.getWithApplied("agg-1", CONTEXT);
        expect(cached?.appliedEventIds).toEqual(["e1", "e2"]);
      });
    });

    describe("when a later fold step is a fresh delivery", () => {
      it("replaces the ids, since the previous batch must have acked", async () => {
        const redis = createRedis();
        const { store } = createStore(redis);

        await store.store(
          { count: 5, UpdatedAt: 200 },
          { ...CONTEXT, appliedEventIds: ["e1"], deliveryAttempt: 1 },
        );
        await store.store(
          { count: 6, UpdatedAt: 201 },
          { ...CONTEXT, appliedEventIds: ["e2"], deliveryAttempt: 1 },
        );

        // The queue holds one active batch per group, so a fresh delivery
        // implies the previous one completed — e1 can never come back, and
        // keeping it is what let the set grow without bound.
        const cached = await store.getWithApplied("agg-1", CONTEXT);
        expect(cached?.appliedEventIds).toEqual(["e2"]);
      });
    });

    describe("when a later fold step is a retry of the same chain", () => {
      it("accumulates, because the earlier events can still be redelivered", async () => {
        const redis = createRedis();
        const { store } = createStore(redis);

        await store.store(
          { count: 5, UpdatedAt: 200 },
          { ...CONTEXT, appliedEventIds: ["e1"], deliveryAttempt: 1 },
        );
        await store.store(
          { count: 6, UpdatedAt: 201 },
          { ...CONTEXT, appliedEventIds: ["e2"], deliveryAttempt: 2 },
        );

        const cached = await store.getWithApplied("agg-1", CONTEXT);
        expect(cached?.appliedEventIds).toEqual(["e1", "e2"]);
      });

      it("does not record the same event twice", async () => {
        const redis = createRedis();
        const { store } = createStore(redis);

        await store.store(
          { count: 5, UpdatedAt: 200 },
          { ...CONTEXT, appliedEventIds: ["e1"], deliveryAttempt: 1 },
        );
        await store.store(
          { count: 5, UpdatedAt: 201 },
          { ...CONTEXT, appliedEventIds: ["e1"], deliveryAttempt: 2 },
        );

        const cached = await store.getWithApplied("agg-1", CONTEXT);
        expect(cached?.appliedEventIds).toEqual(["e1"]);
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
    /** Reads the counter straight off the registry — a spy on a destructured
     *  copy would intercept nothing and pass regardless. */
    async function dedupUnavailableCount(reason: string): Promise<number> {
      const { register } = await import("prom-client");
      const metric = await register
        .getSingleMetric("es_fold_dedup_unavailable_total")
        ?.get();
      return (
        metric?.values.find(
          (v) =>
            v.labels.projection_name === "test_table" &&
            v.labels.reason === reason,
        )?.value ?? 0
      );
    }

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

});
