/**
 * Fold cache size and cost — measurement, not assertion.
 *
 * Two numbers have been argued about without being measured:
 *
 *   1. How much the applied-event-id set adds to a cache entry. The set is
 *      capped at MAX_APPLIED_EVENT_IDS; at ~27-char KSUIDs that is a five-digit
 *      byte figure, and whether it matters depends entirely on how big the
 *      fold state already is.
 *   2. What the full-state GET/SET round-trip costs as a trace grows. The fold
 *      re-reads and re-writes the WHOLE state on every batch, so a 40k-span
 *      trace pays it ~80 times — the O(N^2) that `toCacheable` was originally
 *      invented for and that nothing currently replaces.
 *
 * Reports both against real Redis at realistic state sizes. Deliberately
 * assertion-light: this exists to produce numbers for the plan's Phase 0/3
 * decisions, not to gate CI on a performance threshold that would flake on a
 * loaded laptop. The only assertions are ones that would indicate the
 * measurement itself is broken.
 *
 * Plan: dev/docs/plans/fold-idempotency-plan.md
 */
import type { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  getTestRedisConnection,
  startTestContainers,
  stopTestContainers,
} from "../../../__tests__/integration/testContainers";
import { createTenantId } from "../../../domain/tenantId";
import type { FoldProjectionStore } from "../../foldProjection.types";
import type { ProjectionStoreContext } from "../../projectionStoreContext";
import { RedisCachedFoldStore } from "../../redisCachedFoldStore";
import { MAX_APPLIED_EVENT_IDS } from "../foldCacheEntry";

const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL ||
  process.env.CI_CLICKHOUSE_URL ||
  process.env.REDIS_URL ||
  process.env.CI_REDIS_URL
);

const TENANT = createTenantId("tenant-bench");

/** A KSUID is 27 base62 chars; event ids in this system are KSUIDs. */
function ksuidLike(index: number): string {
  return `2abcDEFghiJKLmnoPQRstu${String(index).padStart(5, "0")}`.slice(0, 27);
}

/**
 * Fold state shaped like a real trace summary: a merged attribute map that
 * grows with span count, plus the IO preview which dominates for large traces
 * (IO_PREVIEW_BYTES is 64 KiB).
 */
function traceLikeState({
  spanCount,
  previewBytes,
  attributeCap = 200,
}: {
  spanCount: number;
  previewBytes: number;
  /**
   * Distinct attribute keys retained. The default stands in for what
   * MAX_PROCESSED_SPANS achieves today: past the cap the fold stops deriving,
   * so the merged attribute map stops growing. Pass Infinity to measure what
   * removing the cap would cost.
   */
  attributeCap?: number;
}) {
  const attributes: Record<string, string> = {};
  // Attributes accumulate across spans — the part of state that grows with N.
  for (let index = 0; index < Math.min(spanCount, attributeCap); index++) {
    attributes[`langwatch.attr.${index}`] = `value-${index}-${"x".repeat(24)}`;
  }
  return {
    UpdatedAt: Date.now(),
    spanCount,
    totalCost: 1.234,
    totalPromptTokenCount: spanCount * 120,
    totalCompletionTokenCount: spanCount * 80,
    computedInput: "i".repeat(previewBytes),
    computedOutput: "o".repeat(previewBytes),
    attributes,
  };
}

const results: string[] = [];
function record(line: string) {
  results.push(line);
}

describe.skipIf(!hasTestcontainers)("fold cache size and cost", () => {
  let redis: Redis;
  const noopDurable: FoldProjectionStore<unknown> = {
    async store() {},
    async get() {
      return null;
    },
  };

  beforeAll(async () => {
    await startTestContainers();
    redis = getTestRedisConnection()!;
  }, 120_000);

  afterEach(async () => {
    const keys = await redis.keys("fold:bench_*");
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    // Written to a file rather than logged: the integration vitest config
    // suppresses console output, so a benchmark that only logs reports nothing.
    const report = `===== fold cache measurements =====\n${results.join("\n")}\n`;
    const fs = await import("node:fs");
    const out =
      process.env.FOLD_CACHE_BENCH_OUT ?? "/tmp/fold-cache-bench.txt";
    fs.writeFileSync(out, report);
    await stopTestContainers();
  });

  function createStore(keyPrefix: string) {
    return new RedisCachedFoldStore<ReturnType<typeof traceLikeState>>(
      noopDurable as FoldProjectionStore<ReturnType<typeof traceLikeState>>,
      redis,
      { keyPrefix, checkDelayMs: 3_600_000 },
    );
  }

  describe("how much the applied-event-id set costs", () => {
    it("measures entry bytes with and without the set, at several state sizes", async () => {
      const cases = [
        { label: "small trace (10 spans, 1 KiB IO)", spanCount: 10, previewBytes: 1_024 },
        { label: "medium trace (500 spans, 16 KiB IO)", spanCount: 500, previewBytes: 16_384 },
        { label: "large trace (40k spans, 64 KiB IO)", spanCount: 40_000, previewBytes: 65_536 },
      ];

      for (const { label, spanCount, previewBytes } of cases) {
        const state = traceLikeState({ spanCount, previewBytes });
        const context: ProjectionStoreContext = {
          aggregateId: `bench-${spanCount}`,
          tenantId: TENANT,
        };

        const bare = createStore("bench_bare");
        await bare.store(state, context);
        const bareBytes = Number(
          await redis.strlen(
            `fold:bench_bare:${String(TENANT)}:bench-${spanCount}`,
          ),
        );

        const withIds = createStore("bench_ids");
        await withIds.store(state, {
          ...context,
          appliedEventIds: Array.from({ length: MAX_APPLIED_EVENT_IDS }, (_, i) =>
            ksuidLike(i),
          ),
        });
        const withIdsBytes = Number(
          await redis.strlen(
            `fold:bench_ids:${String(TENANT)}:bench-${spanCount}`,
          ),
        );

        const overhead = withIdsBytes - bareBytes;
        record(
          `${label.padEnd(38)} state ${(bareBytes / 1024).toFixed(1).padStart(8)} KiB` +
            ` | +applied-set ${(overhead / 1024).toFixed(1).padStart(6)} KiB` +
            ` | total ${(withIdsBytes / 1024).toFixed(1).padStart(8)} KiB` +
            ` | set is ${((overhead / withIdsBytes) * 100).toFixed(1).padStart(5)}% of the entry`,
        );

        expect(bareBytes).toBeGreaterThan(0);
        expect(overhead).toBeGreaterThan(0);
      }
    }, 60_000);
  });

  describe("what the full-state round-trip costs as a trace grows", () => {
    it("measures cumulative GET+SET time across the batches of one large trace", async () => {
      // A 40k-span trace at the 500-event coalesce ceiling is ~80 batches, each
      // re-reading and re-writing the whole state. This is the O(N^2) the plan
      // says is untouched — the numbers say how much it actually matters.
      const batches = [10, 40, 80];

      for (const batchCount of batches) {
        const store = createStore("bench_roundtrip");
        const context: ProjectionStoreContext = {
          aggregateId: `bench-rt-${batchCount}`,
          tenantId: TENANT,
        };

        const startedAt = performance.now();
        let bytesMoved = 0;
        for (let batch = 0; batch < batchCount; batch++) {
          // State grows as the trace does.
          const state = traceLikeState({
            spanCount: (batch + 1) * 500,
            previewBytes: 65_536,
          });
          await store.get(context.aggregateId, context);
          await store.store(state, {
            ...context,
            appliedEventIds: Array.from({ length: 500 }, (_, i) =>
              ksuidLike(batch * 500 + i),
            ),
          });
          bytesMoved += Number(
            await redis.strlen(
              `fold:bench_roundtrip:${String(TENANT)}:${context.aggregateId}`,
            ),
          );
        }
        const elapsedMs = performance.now() - startedAt;

        record(
          `${String(batchCount).padStart(3)} batches (~${((batchCount * 500) / 1000).toFixed(0)}k spans)` +
            ` | ${elapsedMs.toFixed(0).padStart(6)} ms total` +
            ` | ${(elapsedMs / batchCount).toFixed(1).padStart(6)} ms/batch` +
            ` | ${(bytesMoved / 1024 / 1024).toFixed(1).padStart(6)} MiB moved through Redis`,
        );

        expect(elapsedMs).toBeGreaterThan(0);
      }
    }, 120_000);
  });

  describe("what removing MAX_PROCESSED_SPANS would cost", () => {
    it("measures entry size capped vs uncapped as span count grows", async () => {
      // Today the fold stops deriving past 512 spans, so the merged attribute
      // map plateaus and the per-batch round-trip stays flat. Removing the cap
      // means state grows with the trace — this is the size of that decision.
      for (const spanCount of [512, 5_000, 40_000]) {
        const context: ProjectionStoreContext = {
          aggregateId: `bench-cap-${spanCount}`,
          tenantId: TENANT,
        };

        const capped = createStore("bench_capped");
        await capped.store(
          traceLikeState({ spanCount, previewBytes: 65_536 }),
          context,
        );
        const cappedBytes = Number(
          await redis.strlen(
            `fold:bench_capped:${String(TENANT)}:bench-cap-${spanCount}`,
          ),
        );

        const uncapped = createStore("bench_uncapped");
        const startedAt = performance.now();
        await uncapped.store(
          traceLikeState({
            spanCount,
            previewBytes: 65_536,
            attributeCap: Number.POSITIVE_INFINITY,
          }),
          context,
        );
        const writeMs = performance.now() - startedAt;
        const uncappedBytes = Number(
          await redis.strlen(
            `fold:bench_uncapped:${String(TENANT)}:bench-cap-${spanCount}`,
          ),
        );

        record(
          `${String(spanCount).padStart(6)} spans` +
            ` | capped ${(cappedBytes / 1024).toFixed(1).padStart(8)} KiB` +
            ` | uncapped ${(uncappedBytes / 1024).toFixed(1).padStart(9)} KiB` +
            ` | ${(uncappedBytes / cappedBytes).toFixed(1).padStart(5)}x` +
            ` | one uncapped write ${writeMs.toFixed(1).padStart(7)} ms`,
        );

        expect(uncappedBytes).toBeGreaterThanOrEqual(cappedBytes);
      }
    }, 180_000);
  });

});
