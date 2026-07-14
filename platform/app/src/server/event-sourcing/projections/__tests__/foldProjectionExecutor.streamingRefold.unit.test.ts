import { describe, expect, it, vi } from "vitest";
import type { Event } from "../../domain/types";
import {
  createMockFoldProjectionDefinition,
  createMockFoldProjectionStore,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import { FoldProjectionExecutor } from "../foldProjectionExecutor";
import type { ProjectionStoreContext } from "../projectionStoreContext";

/**
 * Streaming store-miss re-fold: for an order-insensitive fold
 * (`refoldOnOutOfOrder: false`) with a paginated loader, the executor pages the
 * aggregate's history via `eventLoaderUpToPaged` and folds page-by-page — so a
 * hot trace's 100k+ events never land in memory whole. This guards the
 * behaviour that prevents a ClickHouse OOM on a store miss for a huge trace.
 *
 * See specs/event-sourcing/hot-trace-fold-amplification.feature.
 */
describe("FoldProjectionExecutor streaming store-miss re-fold", () => {
  const tenantId = createTestTenantId();

  interface CountState {
    ids: string[];
    LastEventOccurredAt: number;
  }

  const init = (): CountState => ({ ids: [], LastEventOccurredAt: 0 });
  const apply = (state: CountState, event: Event): CountState => ({
    ids: [...state.ids, event.id],
    LastEventOccurredAt: Math.max(
      state.LastEventOccurredAt,
      event.occurredAt ?? 0,
    ),
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
   * A paginated loader that serves a fixed (createdAt, id)-sorted history like
   * the real store: honours the strict `after` cursor and the `limit`.
   */
  function pagedLoaderFrom(history: Event[]) {
    return vi.fn(
      async (ctx: {
        tenantId: string;
        aggregateId: string;
        upToEvent: Event;
        after: { timestamp: number; eventId: string } | undefined;
        limit: number;
      }): Promise<Event[]> => {
        const { after, limit } = ctx;
        let start = 0;
        if (after) {
          const idx = history.findIndex(
            (e) =>
              e.createdAt > after.timestamp ||
              (e.createdAt === after.timestamp && e.id > after.eventId),
          );
          start = idx === -1 ? history.length : idx;
        }
        return history.slice(start, start + limit);
      },
    );
  }

  function makeFold(loader: ReturnType<typeof pagedLoaderFrom>) {
    const store = createMockFoldProjectionStore<CountState>();
    (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const foldDef = createMockFoldProjectionDefinition("slim", {
      store,
      init,
      apply,
      options: { refoldOnStoreMiss: true, refoldOnOutOfOrder: false },
    });
    foldDef.eventLoaderUpToPaged = loader;
    // The unbounded array loader must NOT be used when the streaming path runs.
    foldDef.eventLoaderUpTo = vi.fn();
    return { foldDef, store };
  }

  describe("given the store misses and the fold is order-insensitive with a paged loader", () => {
    describe("when the history spans multiple pages", () => {
      it("pages through the whole history and folds every event", async () => {
        const history = [
          ev("e1", 1),
          ev("e2", 2),
          ev("e3", 3),
          ev("e4", 4),
          ev("e5", 5),
        ];
        const loader = pagedLoaderFrom(history);
        const { foldDef, store } = makeFold(loader);
        // 2 events per page → 3 loader calls ([e1,e2] | [e3,e4] | [e5]).
        const executor = new FoldProjectionExecutor(2);

        const result = (await executor.execute(
          foldDef,
          history[4]!,
          context,
        )) as CountState;

        expect(result.ids).toEqual(["e1", "e2", "e3", "e4", "e5"]);
        expect(loader).toHaveBeenCalledTimes(3);
        expect(foldDef.eventLoaderUpTo).not.toHaveBeenCalled();
        expect(store.store).toHaveBeenCalledWith(result, context);
      });
    });

    describe("when a retry shares an idempotencyKey across a page boundary", () => {
      it("folds the logical event once", async () => {
        // e2 and e3 are the same logical event (shared idempotencyKey), split by
        // the page boundary (page size 2 → [e1, e2] | [e3]).
        const history = [ev("e1", 1), ev("e2", 2, "K"), ev("e3", 3, "K")];
        const loader = pagedLoaderFrom(history);
        const { foldDef } = makeFold(loader);
        const executor = new FoldProjectionExecutor(2);

        const result = (await executor.execute(
          foldDef,
          history[2]!,
          context,
        )) as CountState;

        expect(result.ids).toEqual(["e1", "e2"]);
      });
    });

    describe("when the history read has not caught up to the delivered event", () => {
      it("applies the delivered event on top", async () => {
        const history = [ev("e1", 1)];
        const delivered = ev("e2", 2); // persisted but lagging the event-log read
        const loader = pagedLoaderFrom(history);
        const { foldDef } = makeFold(loader);
        const executor = new FoldProjectionExecutor(2);

        const result = (await executor.execute(
          foldDef,
          delivered,
          context,
        )) as CountState;

        expect(result.ids).toEqual(["e1", "e2"]);
      });
    });

    describe("when the history read returns nothing", () => {
      it("falls through to plain init+apply of the delivered event", async () => {
        const loader = pagedLoaderFrom([]);
        const { foldDef, store } = makeFold(loader);
        const executor = new FoldProjectionExecutor(2);
        const e1 = ev("e1", 1);

        const result = (await executor.execute(
          foldDef,
          e1,
          context,
        )) as CountState;

        expect(result.ids).toEqual(["e1"]);
        expect(store.store).toHaveBeenCalled();
        expect(foldDef.eventLoaderUpTo).not.toHaveBeenCalled();
      });
    });
  });
});
