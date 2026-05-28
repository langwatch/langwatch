import { describe, it, expect, vi } from "vitest";
import { RedisCachedFoldStore } from "./redisCachedFoldStore";
import type { FoldProjectionStore } from "./foldProjection.types";
import type { ProjectionStoreContext } from "./projectionStoreContext";

/**
 * The fold cache exists only to make folding fast; ClickHouse is the durable
 * source of truth. For large traces, serializing the full fold state (with the
 * carried input/output text) into Redis on every span is the Redis-clog +
 * O(N²) CPU root cause. `toCacheable` lets a projection cache a lean shape
 * (reductions + winner pointers) while the inner store still persists the
 * full state to ClickHouse.
 */
describe("RedisCachedFoldStore", () => {
  type State = { spanCount: number; computedOutput: string | null };

  const context = {
    tenantId: "tenant-1",
    aggregateId: "trace-1",
    key: "trace-1",
  } as unknown as ProjectionStoreContext;

  function setup(options: { toCacheable?: (s: State) => unknown }) {
    const sets: Array<{ key: string; value: string }> = [];
    const redis = {
      get: vi.fn(async () => null),
      set: vi.fn(async (key: string, value: string) => {
        sets.push({ key, value });
        return "OK";
      }),
    };
    const inner: FoldProjectionStore<State> = {
      get: vi.fn(async () => null),
      store: vi.fn(async () => {}),
    };
    const store = new RedisCachedFoldStore<State>(
      inner as unknown as FoldProjectionStore<State>,
      redis as never,
      { keyPrefix: "traceSummary", ...options },
    );
    return { store, inner, redis, sets };
  }

  describe("given a toCacheable projection that strips the carried output text", () => {
    describe("when store() is called with the full fold state", () => {
      it("persists the full state to the inner (ClickHouse) store", async () => {
        const { store, inner } = setup({
          toCacheable: (s) => ({ ...s, computedOutput: null }),
        });
        const full: State = { spanCount: 3, computedOutput: "X".repeat(50_000) };

        await store.store(full, context);

        expect(inner.store).toHaveBeenCalledWith(full, context);
      });

      it("caches only the lean projection in Redis, without the carried text", async () => {
        const { store, redis, sets } = setup({
          toCacheable: (s) => ({ ...s, computedOutput: null }),
        });
        const full: State = { spanCount: 3, computedOutput: "X".repeat(50_000) };

        await store.store(full, context);

        expect(redis.set).toHaveBeenCalledTimes(1);
        const cached = sets[0]!.value;
        expect(cached).not.toContain("XXXX");
        const parsed = JSON.parse(cached) as State;
        expect(parsed.computedOutput).toBeNull();
        expect(parsed.spanCount).toBe(3);
      });
    });
  });

  describe("given no toCacheable projection (default behaviour)", () => {
    describe("when store() is called", () => {
      it("caches the full state unchanged", async () => {
        const { store, sets } = setup({});
        const full: State = { spanCount: 1, computedOutput: "hello" };

        await store.store(full, context);

        expect(JSON.parse(sets[0]!.value)).toEqual(full);
      });
    });
  });

  describe("given a toCacheable projection and a fold state carrying a 1 MB output", () => {
    describe("when store() is called with the 1 MB output state", () => {
      /** @scenario Folding a trace with a 1 MB output keeps the Redis cache entry lean */
      it("the Redis cache entry does NOT contain the 1 MB output text", async () => {
        const ONE_MB_OUTPUT = "x".repeat(1024 * 1024);
        const { store, sets } = setup({
          toCacheable: (s) => ({ ...s, computedOutput: null }),
        });
        const full: State = { spanCount: 5, computedOutput: ONE_MB_OUTPUT };

        await store.store(full, context);

        const cached = sets[0]!.value;
        // The 1 MB output must NOT appear in the cached entry
        expect(cached.length).toBeLessThan(ONE_MB_OUTPUT.length);
        const parsed = JSON.parse(cached) as State;
        expect(parsed.computedOutput).toBeNull();
        expect(parsed.spanCount).toBe(5);
      });

      it("the inner (ClickHouse) store still receives the full 1 MB output state", async () => {
        const ONE_MB_OUTPUT = "x".repeat(1024 * 1024);
        const { store, inner } = setup({
          toCacheable: (s) => ({ ...s, computedOutput: null }),
        });
        const full: State = { spanCount: 5, computedOutput: ONE_MB_OUTPUT };

        await store.store(full, context);

        // Full state (with 1 MB output) goes to ClickHouse — single source of truth
        expect(inner.store).toHaveBeenCalledWith(full, context);
      });
    });
  });
});
