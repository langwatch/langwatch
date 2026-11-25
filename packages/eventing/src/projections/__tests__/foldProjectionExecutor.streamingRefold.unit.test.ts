import { describe, expect, it, vi } from "vitest";

import type { Event } from "../../domain/types.ts";
import {
  createMockFoldProjectionDefinition,
  createMockFoldProjectionStore,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers.ts";
import {
  compareEventLogPageOrder,
  compareEventLogPagePositions,
  type EventLogPageCursor,
  eventLogPagePositionOf,
} from "../../stores/event-log-page-order.ts";
import { FoldProjectionExecutor } from "../foldProjectionExecutor.ts";
import type { ProjectionStoreContext } from "../projectionStoreContext.ts";

// Pages aggregates page-by-page to prevent ClickHouse OOM on store miss for
// huge traces; see specs/trace-processing/hot-trace-fold-amplification.feature.
describe("FoldProjectionExecutor streaming store-miss re-fold", () => {
  const tenantId = createTestTenantId();

  interface CountState {
    ids: string[];
    LastEventOccurredAt: number;
  }

  const init = (): CountState => ({ ids: [], LastEventOccurredAt: 0 });
  const apply = (state: CountState, event: Event): CountState => ({
    ids: [...state.ids, event.id],
    LastEventOccurredAt: Math.max(state.LastEventOccurredAt, event.occurredAt ?? 0),
  });

  const context: ProjectionStoreContext = {
    aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
    tenantId,
  };

  function ev(id: string, createdAt: number, idempotencyKey?: string): Event {
    const base = createTestEvent(
      TEST_CONSTANTS.AGGREGATE_ID,
      TEST_CONSTANTS.AGGREGATE_TYPE,
      tenantId,
      undefined,
      createdAt,
      undefined,
      {},
      id,
    );
    return idempotencyKey ? { ...base, idempotencyKey } : base;
  }

  /**
   * A paginated loader that serves a fixed history like the real store: in page
   * order, honouring the strict `after` cursor and the `limit`.
   */
  function pagedLoaderFrom(history: Event[]) {
    return vi.fn(
      async (ctx: {
        tenantId: string;
        aggregateId: string;
        upToEvent: Event;
        after: EventLogPageCursor | undefined;
        limit: number;
      }): Promise<Event[]> => {
        const { after, limit } = ctx;
        return history
          .toSorted(compareEventLogPageOrder)
          .filter(
            (e) => !after || compareEventLogPagePositions(eventLogPagePositionOf(e), after) > 0,
          )
          .slice(0, limit);
      },
    );
  }

  function makeFold(
    loader: (ctx: Parameters<ReturnType<typeof pagedLoaderFrom>>[0]) => Promise<Event[]>,
    eventOrdering?: "acceptedAt",
  ) {
    const store = createMockFoldProjectionStore<CountState>();
    (store.get as ReturnType<typeof vi.fn>).mockResolvedValue({ kind: "empty" });
    const foldDef = createMockFoldProjectionDefinition("slim", {
      store,
      init,
      apply,
      options: { refoldOnStoreMiss: true, refoldOnOutOfOrder: false, eventOrdering },
    });
    foldDef.eventLoaderUpToPaged = loader;
    // The unbounded array loader must NOT be used when the streaming path runs.
    foldDef.eventLoaderUpTo = vi.fn();
    return { foldDef, store };
  }

  describe("given the store misses and the fold is order-insensitive with a paged loader", () => {
    describe("when the history spans multiple pages", () => {
      it("pages through the whole history and folds every event", async () => {
        const history = [ev("e1", 1), ev("e2", 2), ev("e3", 3), ev("e4", 4), ev("e5", 5)];
        const loader = pagedLoaderFrom(history);
        const { foldDef, store } = makeFold(loader);
        // 2 events per page → 3 loader calls ([e1,e2] | [e3,e4] | [e5]).
        const executor = new FoldProjectionExecutor({ refoldPageSize: 2 });

        const result = (await executor.execute(foldDef, history[4]!, context)) as CountState;

        expect(result.ids).toEqual(["e1", "e2", "e3", "e4", "e5"]);
        expect(loader).toHaveBeenCalledTimes(3);
        expect(foldDef.eventLoaderUpTo).not.toHaveBeenCalled();
        expect(store.store).toHaveBeenCalledWith(
          result,
          expect.objectContaining({ aggregateId: context.aggregateId }),
        );
      });
    });

    describe("when the history's keys run against its time order", () => {
      /** @scenario "A paged history read seeks through the event log's sort key" */
      it("pages by key from the furthest event of each page, folding every event once", async () => {
        const history = [
          ev("e1", 1, "k4"),
          ev("e2", 2, "k3"),
          ev("e3", 3, "k2"),
          ev("e4", 4, "k1"),
          ev("e5", 5, "k0"),
        ];
        const keyOrdered = pagedLoaderFrom(history);
        // Hands each page back in arrival order, as the memory store does.
        const loader = vi.fn(async (ctx: Parameters<typeof keyOrdered>[0]) =>
          (await keyOrdered(ctx)).toSorted((a, b) => a.createdAt - b.createdAt),
        );
        const { foldDef } = makeFold(loader);
        const executor = new FoldProjectionExecutor({ refoldPageSize: 2 });

        const result = (await executor.execute(foldDef, history[4]!, context)) as CountState;

        expect(result.ids.toSorted()).toEqual(["e1", "e2", "e3", "e4", "e5"]);
        expect(loader).toHaveBeenCalledTimes(3);
        expect(loader.mock.calls[1]![0].after).toEqual({
          idempotencyKey: "k1",
          timestamp: 4,
          eventId: "e4",
        });
      });
    });

    describe("when the fold follows accepted order", () => {
      it("reads its history in time order, never in key-ordered pages", async () => {
        const history = [ev("e1", 1, "z"), ev("e2", 2, "a")];
        const loader = pagedLoaderFrom(history);
        const { foldDef } = makeFold(loader, "acceptedAt");
        foldDef.eventLoaderUpTo = vi.fn().mockResolvedValue(history);
        const executor = new FoldProjectionExecutor({ refoldPageSize: 1 });

        const result = (await executor.execute(foldDef, history[1]!, context)) as CountState;

        expect(loader).not.toHaveBeenCalled();
        expect(result.ids).toEqual(["e1", "e2"]);
      });
    });

    describe("when a retry shares an idempotencyKey across a page boundary", () => {
      it("folds the logical event once", async () => {
        // e2 and e3 are the same logical event (shared idempotencyKey), split by
        // the page boundary (page size 2 → [e1, e2] | [e3]).
        const history = [ev("e1", 1), ev("e2", 2, "K"), ev("e3", 3, "K")];
        const loader = pagedLoaderFrom(history);
        const { foldDef } = makeFold(loader);
        const executor = new FoldProjectionExecutor({ refoldPageSize: 2 });

        const result = (await executor.execute(foldDef, history[2]!, context)) as CountState;

        expect(result.ids).toEqual(["e1", "e2"]);
      });
    });

    describe("when the history read has not caught up to the delivered event", () => {
      it("applies the delivered event on top", async () => {
        const history = [ev("e1", 1)];
        const delivered = ev("e2", 2); // persisted but lagging the event-log read
        const loader = pagedLoaderFrom(history);
        const { foldDef } = makeFold(loader);
        const executor = new FoldProjectionExecutor({ refoldPageSize: 2 });

        const result = (await executor.execute(foldDef, delivered, context)) as CountState;

        expect(result.ids).toEqual(["e1", "e2"]);
      });
    });

    describe("when the history read returns nothing", () => {
      it("falls through to plain init+apply of the delivered event", async () => {
        const loader = pagedLoaderFrom([]);
        const { foldDef, store } = makeFold(loader);
        const executor = new FoldProjectionExecutor({ refoldPageSize: 2 });
        const e1 = ev("e1", 1);

        const result = (await executor.execute(foldDef, e1, context)) as CountState;

        expect(result.ids).toEqual(["e1"]);
        expect(store.store).toHaveBeenCalled();
        expect(foldDef.eventLoaderUpTo).not.toHaveBeenCalled();
      });
    });
  });
});
