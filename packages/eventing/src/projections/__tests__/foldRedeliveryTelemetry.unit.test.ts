import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../metrics.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof metricsModule>();
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

import type { Event } from "../../domain/types.ts";
import { observeEsFoldBlindReapplyEvents } from "../../metrics.ts";
import type * as metricsModule from "../../metrics.ts";
import {
  createMockFoldProjectionDefinition,
  createMockFoldProjectionStore,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers.ts";
import { FoldProjectionExecutor } from "../foldProjectionExecutor.ts";

// When cache eviction causes blind re-apply (applied-event-id set lost), measure
// how much is re-applied; `es_fold_dedup_unavailable_total` counts occurrence.
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
     * entry was evicted between attempts, so the executor can't tell a
     * redelivery from a fresh event and folds on top of state that has it.
     */
    async function foldBlindRetry({
      batch,
      deliveryAttempt,
    }: {
      batch: Event[];
      deliveryAttempt: number;
    }): Promise<void> {
      const store = createMockFoldProjectionStore<{ count: number }>();
      store.getWithApplied = vi
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

        expect(observeEsFoldBlindReapplyEvents).toHaveBeenCalledWith("counter", 4);
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
