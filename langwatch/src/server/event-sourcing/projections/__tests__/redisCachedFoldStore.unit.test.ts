import { beforeEach, describe, expect, it, vi } from "vitest";
import { incrementEsFoldCacheRedisError } from "~/server/metrics";
import { RedisCachedFoldStore } from "../redisCachedFoldStore";
import type { FoldProjectionStore } from "../foldProjection.types";
import type { ProjectionStoreContext } from "../projectionStoreContext";
import { createTenantId } from "../../domain/tenantId";

vi.mock("~/server/metrics", () => ({
  incrementEsFoldCacheRedisError: vi.fn(),
  incrementEsFoldCacheTotal: vi.fn(),
  observeEsFoldCacheGetDuration: vi.fn(),
  observeEsFoldCacheStoreDuration: vi.fn(),
}));

interface TestState {
  count: number;
  name: string;
}

function createMockInnerStore(): FoldProjectionStore<TestState> & {
  getCalls: Array<{ aggregateId: string }>;
  storeCalls: Array<{ state: TestState }>;
} {
  const store = {
    getCalls: [] as Array<{ aggregateId: string }>,
    storeCalls: [] as Array<{ state: TestState }>,

    async get(aggregateId: string): Promise<TestState | null> {
      store.getCalls.push({ aggregateId });
      return { count: 1, name: "from-ch" };
    },

    async store(state: TestState): Promise<void> {
      store.storeCalls.push({ state });
    },
  };

  return store;
}

function createMockRedis() {
  const data = new Map<string, { value: string; ttl: number }>();
  return {
    data,
    get: vi.fn(async (key: string) => data.get(key)?.value ?? null),
    set: vi.fn(
      async (key: string, value: string, _mode: string, ttl: number) => {
        data.set(key, { value, ttl });
        return "OK";
      },
    ),
    del: vi.fn(async (key: string) => (data.delete(key) ? 1 : 0)),
  };
}

const TEST_TENANT_ID = createTenantId("tenant-1");
const TEST_CONTEXT: ProjectionStoreContext = {
  aggregateId: "agg-1",
  tenantId: TEST_TENANT_ID,
};

describe("RedisCachedFoldStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("get()", () => {
    describe("when Redis has cached state", () => {
      it("returns cached state without calling inner store", async () => {
        const redis = createMockRedis();
        const inner = createMockInnerStore();
        const store = new RedisCachedFoldStore<TestState>(inner, redis as any, {
          keyPrefix: "test_table",
        });

        const state: TestState = { count: 5, name: "cached" };
        redis.data.set("fold:test_table:tenant-1:agg-1", {
          value: JSON.stringify(state),
          ttl: 30,
        });

        const result = await store.get("agg-1", TEST_CONTEXT);

        expect(result).toEqual(state);
        expect(redis.get).toHaveBeenCalledWith(
          "fold:test_table:tenant-1:agg-1",
        );
        expect(inner.getCalls).toHaveLength(0);
      });
    });

    describe("when Redis cache misses", () => {
      it("reads from inner store without caching the result", async () => {
        const redis = createMockRedis();
        const inner = createMockInnerStore();
        const store = new RedisCachedFoldStore<TestState>(inner, redis as any, {
          keyPrefix: "test_table",
        });

        const result = await store.get("agg-1", TEST_CONTEXT);

        expect(result).toEqual({ count: 1, name: "from-ch" });
        expect(inner.getCalls).toHaveLength(1);
        expect(redis.set).not.toHaveBeenCalled();
      });
    });
  });

  describe("store()", () => {
    describe("when storing state", () => {
      it("writes to CH first then caches in Redis", async () => {
        const redis = createMockRedis();
        const inner = createMockInnerStore();
        const store = new RedisCachedFoldStore<TestState>(inner, redis as any, {
          keyPrefix: "test_table",
          ttlSeconds: 30,
        });

        const state: TestState = { count: 10, name: "new-state" };
        await store.store(state, TEST_CONTEXT);

        // CH written first
        expect(inner.storeCalls).toHaveLength(1);
        expect(inner.storeCalls[0]!.state).toEqual(state);

        // Then Redis cached
        expect(redis.set).toHaveBeenCalledWith(
          "fold:test_table:tenant-1:agg-1",
          JSON.stringify(state),
          "EX",
          30,
        );
      });
    });

    describe("when inner store write fails", () => {
      it("propagates the error to the caller", async () => {
        const redis = createMockRedis();
        const innerStore: FoldProjectionStore<TestState> = {
          get: vi.fn(),
          store: vi.fn().mockRejectedValue(new Error("CH connection refused")),
        };

        const store = new RedisCachedFoldStore<TestState>(
          innerStore,
          redis as any,
          { keyPrefix: "test_table" },
        );

        await expect(
          store.store({ count: 1, name: "test" }, TEST_CONTEXT),
        ).rejects.toThrow("CH connection refused");

        // Redis should NOT have been updated (CH writes first)
        expect(redis.set).not.toHaveBeenCalled();
      });
    });

    describe("given Redis SET fails", () => {
      describe("when storing state", () => {
        it("deletes the same cache key and throws", async () => {
          const redis = createMockRedis();
          redis.set.mockRejectedValueOnce(new Error("Redis unavailable"));
          const inner = createMockInnerStore();
          const store = new RedisCachedFoldStore<TestState>(
            inner,
            redis as any,
            {
              keyPrefix: "test_table",
            },
          );

          await expect(
            store.store({ count: 2, name: "new-state" }, TEST_CONTEXT),
          ).rejects.toThrow("Redis unavailable");

          expect(redis.del).toHaveBeenCalledWith(
            "fold:test_table:tenant-1:agg-1",
          );
        });
      });
    });

    describe("given Redis SET and DEL both fail", () => {
      describe("when storing state", () => {
        it("throws and records the SET failure metric", async () => {
          const redis = createMockRedis();
          redis.set.mockRejectedValueOnce(new Error("SET failed"));
          redis.del.mockRejectedValueOnce(new Error("DEL failed"));
          const inner = createMockInnerStore();
          const store = new RedisCachedFoldStore<TestState>(
            inner,
            redis as any,
            {
              keyPrefix: "test_table",
            },
          );

          await expect(
            store.store({ count: 2, name: "new-state" }, TEST_CONTEXT),
          ).rejects.toThrow("SET failed");

          expect(incrementEsFoldCacheRedisError).toHaveBeenCalledWith(
            "test_table",
            "set",
          );
        });
      });
    });
  });

  describe("given a retry after Redis SET fails and DEL succeeds", () => {
    describe("when the fold is retried", () => {
      it("falls through to durable state and re-stores the converged state", async () => {
        const redis = createMockRedis();
        const cacheKey = "fold:test_table:tenant-1:agg-1";
        let durableState: TestState = { count: 1, name: "before-event" };
        const inner: FoldProjectionStore<TestState> = {
          get: vi.fn(async () => durableState),
          store: vi.fn(async (state: TestState) => {
            durableState = state;
          }),
        };
        const store = new RedisCachedFoldStore<TestState>(inner, redis as any, {
          keyPrefix: "test_table",
        });
        const applyEvent = (state: TestState): TestState => ({
          count: Math.max(state.count, 2),
          name: "after-event",
        });

        redis.data.set(cacheKey, {
          value: JSON.stringify(durableState),
          ttl: 30,
        });
        redis.set.mockRejectedValueOnce(new Error("SET failed"));

        const firstState = await store.get("agg-1", TEST_CONTEXT);
        await expect(
          store.store(applyEvent(firstState!), TEST_CONTEXT),
        ).rejects.toThrow("SET failed");
        expect(redis.data.has(cacheKey)).toBe(false);

        const retryState = await store.get("agg-1", TEST_CONTEXT);
        expect(retryState).toEqual({ count: 2, name: "after-event" });

        const convergedState = applyEvent(retryState!);
        await store.store(convergedState, TEST_CONTEXT);

        expect(inner.get).toHaveBeenCalledWith("agg-1", TEST_CONTEXT);
        expect(inner.store).toHaveBeenLastCalledWith(
          { count: 2, name: "after-event" },
          TEST_CONTEXT,
        );
        expect(JSON.parse(redis.data.get(cacheKey)!.value)).toEqual({
          count: 2,
          name: "after-event",
        });
      });
    });
  });

  describe("end-to-end fold sequence", () => {
    it("second fold step reads from Redis after first store caches it", async () => {
      const redis = createMockRedis();
      const inner = createMockInnerStore();
      const store = new RedisCachedFoldStore<TestState>(inner, redis as any, {
        keyPrefix: "test_table",
      });

      // Step 1: get (miss → CH) → apply → store (caches in Redis)
      const state1 = await store.get("agg-1", TEST_CONTEXT);
      expect(state1).toEqual({ count: 1, name: "from-ch" });
      expect(inner.getCalls).toHaveLength(1);

      const newState: TestState = { count: 2, name: "after-apply" };
      await store.store(newState, TEST_CONTEXT);

      // Step 2: get (hit from Redis) — inner store NOT called again
      const state2 = await store.get("agg-1", TEST_CONTEXT);
      expect(state2).toEqual(newState);
      expect(inner.getCalls).toHaveLength(1);
    });
  });
});
