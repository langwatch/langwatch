import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "../../domain/types";
import {
  createMockFoldProjectionDefinition,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import type { FoldProjectionStore } from "../foldProjection.types";
import { FoldProjectionExecutor } from "../foldProjectionExecutor";
import type { ProjectionStoreContext } from "../projectionStoreContext";

/**
 * Durable dedup watermark (ADR-066, sequencing step 4).
 *
 * A store that exposes `getWithApplied` persists the applied-event-id set next
 * to its state row, so a retry that reaches a cold cache still learns which
 * events an earlier attempt committed. The executor prefers that set over a
 * blind re-apply, and — critically — records the UNION of the loaded set and
 * the fresh ids at commit, so a retry chain that keeps losing its cache cannot
 * lose track of a batch it already folded in.
 */
describe("FoldProjectionExecutor durable dedup", () => {
  const tenantId = createTestTenantId();

  interface FoldState {
    ids: string[];
    LastEventOccurredAt: number;
  }

  const init = (): FoldState => ({ ids: [], LastEventOccurredAt: 0 });

  function makeEvent(id: string, createdAt: number): Event {
    return createTestEvent(
      TEST_CONSTANTS.AGGREGATE_ID,
      TEST_CONSTANTS.AGGREGATE_TYPE,
      tenantId,
      undefined,
      createdAt,
      undefined,
      {},
      id,
    );
  }

  /**
   * A store whose durable read (`getWithApplied`) answers with a preset state
   * and applied-event-id set — the shape a read-back store returns from
   * ClickHouse when the Redis cache is cold.
   */
  function durableStore({
    state,
    appliedEventIds,
  }: {
    state: FoldState | null;
    appliedEventIds: string[];
  }): {
    store: FoldProjectionStore<FoldState>;
    storeFn: ReturnType<typeof vi.fn>;
  } {
    const storeFn = vi.fn().mockResolvedValue(undefined);
    const store: FoldProjectionStore<FoldState> = {
      get: vi.fn().mockResolvedValue(state),
      getWithApplied: vi.fn().mockResolvedValue({ state, appliedEventIds }),
      store: storeFn,
    };
    return { store, storeFn };
  }

  function appendingApply() {
    return vi.fn((state: FoldState, event: Event): FoldState => ({
      ids: [...state.ids, event.id],
      LastEventOccurredAt: Math.max(state.LastEventOccurredAt, event.occurredAt ?? 0),
    }));
  }

  const contextWith = (
    over: Partial<ProjectionStoreContext>,
  ): ProjectionStoreContext => ({
    aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
    tenantId,
    ...over,
  });

  let executor: FoldProjectionExecutor;

  beforeEach(() => {
    executor = new FoldProjectionExecutor();
  });

  describe("given the durable applied-set already contains the redelivered batch", () => {
    describe("when the same batch is redelivered on a retry with a cold cache", () => {
      /** @scenario a redelivered batch after a committed write does not double-count */
      it("does not re-apply, does not re-store, and returns the loaded state", async () => {
        const a = makeEvent("a", 1000);
        const b = makeEvent("b", 2000);
        const loadedState: FoldState = {
          ids: ["a", "b"],
          LastEventOccurredAt: 2000,
        };
        const { store, storeFn } = durableStore({
          state: loadedState,
          appliedEventIds: ["a", "b"],
        });
        const apply = appendingApply();
        const fold = createMockFoldProjectionDefinition("dedup", {
          store,
          init,
          apply,
        });

        const result = (await executor.executeBatch(fold, [a, b], {
          aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
          tenantId,
          deliveryAttempt: 2,
        })) as FoldState;

        expect(apply).not.toHaveBeenCalled();
        expect(storeFn).not.toHaveBeenCalled();
        expect(result).toBe(loadedState);
      });
    });
  });

  describe("given a retry chain that keeps losing its cache", () => {
    describe("when attempt 2 delivers the whole batch against the acked prefix", () => {
      it("folds only the fresh remainder and records the union of loaded and fresh ids", async () => {
        const [a, b, c, d] = [
          makeEvent("a", 1000),
          makeEvent("b", 2000),
          makeEvent("c", 3000),
          makeEvent("d", 4000),
        ];
        // Attempt 1 committed {a,b} then crashed pre-ack; its cache entry was
        // lost, so only the durable row's {a,b} remains.
        const { store, storeFn } = durableStore({
          state: { ids: ["a", "b"], LastEventOccurredAt: 2000 },
          appliedEventIds: ["a", "b"],
        });
        const fold = createMockFoldProjectionDefinition("dedup", {
          store,
          init,
          apply: appendingApply(),
        });

        const result = (await executor.executeBatch(
          fold,
          [a!, b!, c!, d!],
          contextWith({ deliveryAttempt: 2 }),
        )) as FoldState;

        // Only c and d were fresh; a and b were recognised and dropped.
        expect(result.ids).toEqual(["a", "b", "c", "d"]);
        expect(storeFn).toHaveBeenCalledTimes(1);
        // The commit records the UNION, so a later redelivery of the whole
        // batch against this row recognises every event.
        expect(storeFn.mock.calls[0]![1].appliedEventIds).toEqual(["a", "b", "c", "d"]);
      });
    });

    describe("when a subsequent attempt 3 redelivers the whole batch against the union", () => {
      it("drops every event and never stores", async () => {
        const [a, b, c, d] = [
          makeEvent("a", 1000),
          makeEvent("b", 2000),
          makeEvent("c", 3000),
          makeEvent("d", 4000),
        ];
        const loadedState: FoldState = {
          ids: ["a", "b", "c", "d"],
          LastEventOccurredAt: 4000,
        };
        const { store, storeFn } = durableStore({
          state: loadedState,
          appliedEventIds: ["a", "b", "c", "d"],
        });
        const apply = appendingApply();
        const fold = createMockFoldProjectionDefinition("dedup", {
          store,
          init,
          apply,
        });

        const result = (await executor.executeBatch(
          fold,
          [a!, b!, c!, d!],
          contextWith({ deliveryAttempt: 3 }),
        )) as FoldState;

        expect(apply).not.toHaveBeenCalled();
        expect(storeFn).not.toHaveBeenCalled();
        expect(result).toBe(loadedState);
      });
    });
  });

  describe("given a fresh delivery", () => {
    describe("when the batch commits", () => {
      it("records only this batch's ids, resetting the durable set", async () => {
        const a = makeEvent("a", 3000);
        const b = makeEvent("b", 4000);
        // A previous, acked batch left {x,y} on the durable row. A fresh
        // delivery means that batch completed, so its ids can never be
        // redelivered and must not be carried forward.
        const { store, storeFn } = durableStore({
          state: { ids: ["x", "y"], LastEventOccurredAt: 500 },
          appliedEventIds: ["x", "y"],
        });
        const fold = createMockFoldProjectionDefinition("dedup", {
          store,
          init,
          apply: appendingApply(),
        });

        await executor.executeBatch(fold, [a, b], contextWith({ deliveryAttempt: 1 }));

        expect(storeFn).toHaveBeenCalledTimes(1);
        expect(storeFn.mock.calls[0]![1].appliedEventIds).toEqual(["a", "b"]);
      });
    });
  });

  describe("given a single redelivered event on the execute path", () => {
    describe("when the durable set already contains it", () => {
      /** @scenario a redelivered batch after a committed write does not double-count */
      it("does not apply or store and returns the loaded state", async () => {
        const a = makeEvent("a", 1000);
        const loadedState: FoldState = {
          ids: ["a"],
          LastEventOccurredAt: 1000,
        };
        const { store, storeFn } = durableStore({
          state: loadedState,
          appliedEventIds: ["a"],
        });
        const apply = appendingApply();
        const fold = createMockFoldProjectionDefinition("dedup", {
          store,
          init,
          apply,
        });

        const result = (await executor.execute(
          fold,
          a,
          contextWith({ deliveryAttempt: 2 }),
        )) as FoldState;

        expect(apply).not.toHaveBeenCalled();
        expect(storeFn).not.toHaveBeenCalled();
        expect(result).toBe(loadedState);
      });
    });
  });
});
