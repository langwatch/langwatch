import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/metrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/metrics")>();
  return {
    ...actual,
    observeEsFoldBlindReapplyEvents: vi.fn(),
    incrementEsFoldProjectionTotal: vi.fn(),
    observeEsFoldProjectionDuration: vi.fn(),
    incrementEsFoldRefoldTotal: vi.fn(),
    incrementEsFoldDuplicateEventsSkipped: vi.fn(),
    incrementEsReactorTotal: vi.fn(),
    incrementEsReactorCollapsedTotal: vi.fn(),
  };
});

import { observeEsFoldBlindReapplyEvents } from "~/server/metrics";
import type { Event } from "../../domain/types";
import {
  createMockFoldProjectionDefinition,
  createMockFoldProjectionStore,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import { FoldProjectionExecutor } from "../foldProjectionExecutor";

/**
 * Blast radius of a blind re-apply.
 *
 * The applied-event-id set is what stops a redelivery being folded twice, and
 * it lives in the cache entry — so an eviction between attempts takes it. When
 * that happens the executor cannot tell a redelivery from a fresh event and
 * folds the batch on top of state that already contains it.
 *
 * `es_fold_dedup_unavailable_total` already counts that this happened; these pin
 * the measure of how much each occurrence re-applies, which on a coalesced batch
 * is the difference between one double-counted span and five hundred.
 */
describe("fold redelivery telemetry", () => {
  const tenantId = createTestTenantId();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const events = (count: number): Event[] =>
    Array.from({ length: count }, (_, i) =>
      createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        undefined,
        1_000 + i,
        undefined,
        undefined,
        `event-${i}`,
      ),
    );

  describe("given a retry whose applied-event-id set did not survive", () => {
    /**
     * getWithApplied answers with state but an empty applied-set — the cache
     * entry was evicted between attempts. The executor cannot tell a redelivery
     * from a fresh event, so it folds everything on top of state that already
     * contains it.
     */
    async function foldBlindRetry({
      batch,
      deliveryAttempt,
    }: {
      batch: Event[];
      deliveryAttempt: number;
    }): Promise<void> {
      const store = createMockFoldProjectionStore<{ count: number }>();
      (
        store as unknown as { getWithApplied: ReturnType<typeof vi.fn> }
      ).getWithApplied = vi
        .fn()
        .mockResolvedValue({ state: { count: 7 }, appliedEventIds: [] });

      const fold = createMockFoldProjectionDefinition("counter", {
        store,
        init: () => ({ count: 0 }),
        apply: (state: { count: number }) => ({ count: state.count + 1 }),
      });

      await new FoldProjectionExecutor().executeBatch(fold, batch, {
        aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
        tenantId,
        deliveryAttempt,
      });
    }

    describe("when the retry re-applies the batch", () => {
      it("records how many events were re-applied blind", async () => {
        await foldBlindRetry({ batch: events(4), deliveryAttempt: 2 });

        expect(observeEsFoldBlindReapplyEvents).toHaveBeenCalledWith(
          "counter",
          4,
        );
      });
    });

    describe("when it is a fresh delivery rather than a retry", () => {
      it("records nothing, because an empty set is expected on attempt one", async () => {
        await foldBlindRetry({ batch: events(4), deliveryAttempt: 1 });

        expect(observeEsFoldBlindReapplyEvents).not.toHaveBeenCalled();
      });
    });
  });
});
