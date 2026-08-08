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
 * A commit must record every id it RECOGNISED, not only the ids it folded
 * fresh (#6578).
 *
 * The applied-event-id set answers one question: "has this aggregate already
 * absorbed this event?" An id that arrives in a batch and is correctly dropped
 * as already-applied is still an id the committed state absorbs — so dropping
 * it from the set on the way out is a lie the next delivery believes.
 *
 * A first-attempt commit replaces the set (bounded garbage collection), so
 * recording only the fresh ids EVICTS any redelivered id that rode along.
 * Whoever sees that id next treats it as new and folds it a second time.
 * Batch coalescing and bisection both make an already-applied id riding along
 * with fresh ones ordinary rather than exotic.
 */
describe("FoldProjectionExecutor applied-set eviction", () => {
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

  const appendingApply = () =>
    vi.fn(
      (state: FoldState, event: Event): FoldState => ({
        ids: [...state.ids, event.id],
        LastEventOccurredAt: Math.max(
          state.LastEventOccurredAt,
          event.occurredAt ?? 0,
        ),
      }),
    );

  const committedAppliedIds = (storeFn: ReturnType<typeof vi.fn>): string[] =>
    ((storeFn.mock.calls[0]?.[1] as ProjectionStoreContext | undefined)
      ?.appliedEventIds ?? []) as string[];

  let executor: FoldProjectionExecutor;

  beforeEach(() => {
    executor = new FoldProjectionExecutor();
  });

  describe("given a batch carrying one already-applied event and three new ones", () => {
    describe("when it commits on a first attempt", () => {
      it("keeps the already-applied id in the set instead of evicting it", async () => {
        const events = ["c0", "c1", "c2", "c3"].map((id, index) =>
          makeEvent(id, 1000 + index),
        );
        const { store, storeFn } = durableStore({
          state: { ids: ["c0"], LastEventOccurredAt: 1000 },
          appliedEventIds: ["c0"],
        });
        const fold = createMockFoldProjectionDefinition("eviction", {
          store,
          init,
          apply: appendingApply(),
        });

        await executor.executeBatch(fold, events, {
          aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
          tenantId,
        });

        // c0 was correctly not re-folded — but the state it is folded into is
        // the one being committed, so the set must still vouch for it. Drop it
        // and the next delivery carrying c0 folds it twice.
        expect([...committedAppliedIds(storeFn)].sort()).toEqual([
          "c0",
          "c1",
          "c2",
          "c3",
        ]);
      });
    });
  });

  describe("given a single already-applied event redelivered alongside nothing", () => {
    describe("when the batch is entirely redelivery", () => {
      it("does not store at all, so nothing can be evicted", async () => {
        const events = ["c0", "c1"].map((id, index) =>
          makeEvent(id, 1000 + index),
        );
        const { store, storeFn } = durableStore({
          state: { ids: ["c0", "c1"], LastEventOccurredAt: 1001 },
          appliedEventIds: ["c0", "c1"],
        });
        const fold = createMockFoldProjectionDefinition("eviction-noop", {
          store,
          init,
          apply: appendingApply(),
        });

        await executor.executeBatch(fold, events, {
          aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
          tenantId,
        });

        expect(storeFn).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a fresh delivery with nothing previously applied", () => {
    describe("when it commits", () => {
      it("records exactly the delivered ids, keeping the set bounded", async () => {
        const events = ["a", "b"].map((id, index) =>
          makeEvent(id, 1000 + index),
        );
        const { store, storeFn } = durableStore({
          state: null,
          appliedEventIds: [],
        });
        const fold = createMockFoldProjectionDefinition("eviction-fresh", {
          store,
          init,
          apply: appendingApply(),
        });

        await executor.executeBatch(fold, events, {
          aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
          tenantId,
        });

        // The replace-on-fresh-delivery garbage collection still holds: the
        // set is this delivery's ids, not an ever-growing history.
        expect([...committedAppliedIds(storeFn)].sort()).toEqual(["a", "b"]);
      });
    });
  });
});
