import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { incrementEsFoldRefoldTotal } from "../../metrics";

vi.mock("../../metrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../metrics")>();
  return { ...actual, incrementEsFoldRefoldTotal: vi.fn() };
});

import type { Event } from "../../domain/types";
import {
  createMockFoldProjectionDefinition,
  createMockFoldProjectionStore,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import type { FoldProjectionDefinition } from "../foldProjection.types";
import { FoldProjectionExecutor } from "../foldProjectionExecutor";
import type { ProjectionStoreContext } from "../projectionStoreContext";

/**
 * State whose `apply` mirrors AbstractFoldProjection: it counts events and
 * carries the monotonic occurredAt high-water mark the executor reads to detect
 * out-of-order arrival.
 */
interface CounterState {
  count: number;
  LastEventOccurredAt: number;
}

const CHECKPOINT_MS = 5_000;

function makeFold({
  storedState,
  loadedEvents,
  refoldOnOutOfOrder,
  withEventLoader = true,
}: {
  storedState: CounterState | null;
  loadedEvents?: Event[];
  refoldOnOutOfOrder?: boolean;
  /** Omit the loader to exercise the degraded "unavailable" path. */
  withEventLoader?: boolean;
}) {
  const store = createMockFoldProjectionStore<CounterState>();
  (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(storedState);

  const fold = createMockFoldProjectionDefinition("counter", {
    store,
    init: () => ({ count: 0, LastEventOccurredAt: 0 }),
    apply: (state: CounterState, event: Event) => ({
      count: state.count + 1,
      LastEventOccurredAt: Math.max(state.LastEventOccurredAt, event.occurredAt ?? 0),
    }),
  }) as FoldProjectionDefinition<CounterState, Event>;

  const eventLoader = vi.fn().mockResolvedValue(loadedEvents ?? []);
  if (withEventLoader) fold.eventLoader = eventLoader;
  else fold.eventLoader = undefined;
  if (refoldOnOutOfOrder !== undefined) fold.options = { refoldOnOutOfOrder };

  return { fold, store, eventLoader };
}

const refoldMetric = incrementEsFoldRefoldTotal as unknown as ReturnType<typeof vi.fn>;

describe("FoldProjectionExecutor out-of-order re-fold", () => {
  const tenantId = createTestTenantId();
  const context: ProjectionStoreContext = {
    aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
    tenantId,
  };
  let executor: FoldProjectionExecutor;

  const eventAt = (occurredAt: number) =>
    createTestEvent(
      TEST_CONSTANTS.AGGREGATE_ID,
      TEST_CONSTANTS.AGGREGATE_TYPE,
      tenantId,
      undefined,
      occurredAt,
    );

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
    executor = new FoldProjectionExecutor();
    refoldMetric.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("given a batch that starts before the persisted checkpoint", () => {
    describe("when the projection declares no re-fold policy", () => {
      /** @scenario "An out-of-order batch re-folds from the event log by default" */
      it("loads the aggregate's full history and replays it from init state", async () => {
        const delivered = [eventAt(1_000), eventAt(2_000)];
        const history = [...delivered, eventAt(CHECKPOINT_MS)];
        const { fold, store, eventLoader } = makeFold({
          storedState: { count: 99, LastEventOccurredAt: CHECKPOINT_MS },
          loadedEvents: history,
        });

        const result = await executor.executeBatch(fold, delivered, context);

        expect(eventLoader).toHaveBeenCalledWith({
          tenantId,
          aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
          occurredAtMs: 1_000,
        });
        // Replayed from init(), so the stored count of 99 is discarded entirely.
        expect(result.count).toBe(history.length);
        expect(store.store).toHaveBeenCalledOnce();
        expect(refoldMetric).toHaveBeenCalledWith("counter", "performed");
      });

      /** @scenario "Evaluation folds keep re-folding because order is significant" */
      it("replays an order-dependent fold from its occurred-at-sorted history", async () => {
        interface OrderState {
          sequence: number[];
          LastEventOccurredAt: number;
        }

        const late = eventAt(1_000);
        const history = [late, eventAt(2_000), eventAt(3_000), eventAt(CHECKPOINT_MS)];
        const store = createMockFoldProjectionStore<OrderState>();
        (store.get as ReturnType<typeof vi.fn>).mockResolvedValue({
          sequence: [5_000],
          LastEventOccurredAt: CHECKPOINT_MS,
        });
        const fold = createMockFoldProjectionDefinition("evaluation", {
          store,
          init: () => ({ sequence: [], LastEventOccurredAt: 0 }),
          apply: (state: OrderState, event: Event): OrderState => ({
            sequence: [...state.sequence, event.occurredAt ?? 0],
            LastEventOccurredAt: event.occurredAt ?? 0,
          }),
        }) as FoldProjectionDefinition<OrderState, Event>;
        fold.eventLoader = vi.fn().mockResolvedValue(history);

        const result = await executor.execute(fold, late, context);

        expect(result.sequence).toEqual([1_000, 2_000, 3_000, CHECKPOINT_MS]);
        expect(fold.eventLoader).toHaveBeenCalledOnce();
        expect(refoldMetric).toHaveBeenCalledWith("evaluation", "performed");
      });
    });

    describe("when the event log read does not return the delivered event yet", () => {
      interface OrderState {
        sequence: number[];
        LastEventOccurredAt: number;
      }

      function makeOrderFold(history: Event[]) {
        const store = createMockFoldProjectionStore<OrderState>();
        (store.get as ReturnType<typeof vi.fn>).mockResolvedValue({
          sequence: [1_000, 2_000, CHECKPOINT_MS],
          LastEventOccurredAt: CHECKPOINT_MS,
        });
        const fold = createMockFoldProjectionDefinition("run", {
          store,
          init: () => ({ sequence: [], LastEventOccurredAt: 0 }),
          apply: (state: OrderState, event: Event): OrderState => ({
            sequence: [...state.sequence, event.occurredAt ?? 0],
            LastEventOccurredAt: Math.max(state.LastEventOccurredAt, event.occurredAt ?? 0),
          }),
        }) as FoldProjectionDefinition<OrderState, Event>;
        fold.eventLoader = vi.fn().mockResolvedValue(history);
        return { fold, store };
      }

      /** @scenario "A re-fold folds in a delivered event the event log has not returned yet" */
      it("merges the delivered event into the replayed history in occurred-at order", async () => {
        // The log read runs right after the append and comes back without it.
        const history = [eventAt(1_000), eventAt(2_000), eventAt(CHECKPOINT_MS)];
        const { fold, store } = makeOrderFold(history);
        const late = eventAt(3_000);

        const result = await executor.execute(fold, late, context);

        expect(result.sequence).toEqual([1_000, 2_000, 3_000, CHECKPOINT_MS]);
        expect(store.store).toHaveBeenCalledOnce();
      });

      /** @scenario "A re-fold folds in a delivered batch the event log has not returned yet" */
      it("merges every delivered event of an out-of-order batch the history misses", async () => {
        const known = eventAt(2_000);
        const history = [eventAt(1_000), known, eventAt(CHECKPOINT_MS)];
        const { fold } = makeOrderFold(history);

        const result = await executor.executeBatch(
          fold,
          [eventAt(3_000), known, eventAt(4_000)],
          context,
        );

        // `known` was returned by the read, so it is folded exactly once.
        expect(result.sequence).toEqual([1_000, 2_000, 3_000, 4_000, CHECKPOINT_MS]);
      });
    });

    describe("when the history read cannot account for the loaded state", () => {
      interface OrderState {
        sequence: number[];
        LastEventOccurredAt: number;
      }

      /**
       * A state committed with applied ids: `getWithApplied` is what carries
       * them, so the fence has the previous commit to check the read against.
       */
      function makeAppliedFold({
        historyReads,
        appliedEventIds,
      }: {
        /** One history per read; the last one answers every later read. */
        historyReads: Event[][];
        appliedEventIds: string[];
      }) {
        const store = createMockFoldProjectionStore<OrderState>();
        (
          store as unknown as {
            getWithApplied: ReturnType<typeof vi.fn>;
          }
        ).getWithApplied = vi.fn().mockResolvedValue({
          state: {
            sequence: [1_000, 2_000, CHECKPOINT_MS],
            LastEventOccurredAt: CHECKPOINT_MS,
          },
          appliedEventIds,
        });
        const fold = createMockFoldProjectionDefinition("run", {
          store,
          init: () => ({ sequence: [], LastEventOccurredAt: 0 }),
          apply: (state: OrderState, event: Event): OrderState => ({
            sequence: [...state.sequence, event.occurredAt ?? 0],
            LastEventOccurredAt: Math.max(state.LastEventOccurredAt, event.occurredAt ?? 0),
          }),
        }) as FoldProjectionDefinition<OrderState, Event>;
        const eventLoader = vi.fn();
        for (const history of historyReads) {
          eventLoader.mockResolvedValueOnce(history);
        }
        eventLoader.mockResolvedValue(historyReads[historyReads.length - 1]);
        fold.eventLoader = eventLoader;
        return { fold, store, eventLoader };
      }

      /** @scenario "A re-fold never replaces state from a history read missing an applied event" */
      it("keeps the loaded state and applies the event on top when an applied event never appears", async () => {
        vi.useRealTimers();
        // No retry budget: the read stays incomplete for the whole call.
        const strictExecutor = new FoldProjectionExecutor({
          refoldHistoryRetryDelaysMs: [],
        });
        const checkpointEvent = eventAt(CHECKPOINT_MS);
        // The read returns the checkpoint but not the applied event "evt-a".
        const { fold, store } = makeAppliedFold({
          historyReads: [[eventAt(2_000), checkpointEvent]],
          appliedEventIds: ["evt-a", checkpointEvent.id],
        });
        const late = eventAt(3_000);

        const result = await strictExecutor.execute(fold, late, context);

        // The loaded sequence survives whole; the late event lands on top,
        // out of order but not lost, and the replayed-from-init overwrite
        // never happens.
        expect(result.sequence).toEqual([1_000, 2_000, CHECKPOINT_MS, 3_000]);
        expect(store.store).toHaveBeenCalledOnce();
        expect(refoldMetric).toHaveBeenCalledWith("run", "incomplete");
      });

      /** @scenario "A re-fold retries a history read that has not caught up yet" */
      it("replays the full history when a retry read returns it", async () => {
        vi.useRealTimers();
        const retryingExecutor = new FoldProjectionExecutor({
          refoldHistoryRetryDelaysMs: [1],
        });
        const checkpointEvent = eventAt(CHECKPOINT_MS);
        const appliedEvent = { ...eventAt(4_000), id: "evt-a" };
        const fullHistory = [eventAt(2_000), appliedEvent, checkpointEvent];
        const { fold, eventLoader } = makeAppliedFold({
          historyReads: [[eventAt(2_000), checkpointEvent], fullHistory],
          appliedEventIds: ["evt-a", checkpointEvent.id],
        });
        const late = eventAt(3_000);

        const result = await retryingExecutor.execute(fold, late, context);

        expect(eventLoader).toHaveBeenCalledTimes(2);
        expect(result.sequence).toEqual([2_000, 3_000, 4_000, CHECKPOINT_MS]);
        expect(refoldMetric).not.toHaveBeenCalledWith("run", "incomplete");
      });

      /** @scenario "A re-fold never replaces state from a history read behind the checkpoint" */
      it("keeps the loaded state when nothing read reaches the occurred-at checkpoint", async () => {
        vi.useRealTimers();
        const strictExecutor = new FoldProjectionExecutor({
          refoldHistoryRetryDelaysMs: [],
        });
        // The applied set is empty (a get()-only store), so only the
        // checkpoint fence can see that the read is missing the event that
        // set the state's high-water mark at CHECKPOINT_MS.
        const { fold, store } = makeAppliedFold({
          historyReads: [[eventAt(1_000), eventAt(2_000)]],
          appliedEventIds: [],
        });
        const late = eventAt(3_000);

        const result = await strictExecutor.execute(fold, late, context);

        expect(result.sequence).toEqual([1_000, 2_000, CHECKPOINT_MS, 3_000]);
        expect(store.store).toHaveBeenCalledOnce();
        expect(refoldMetric).toHaveBeenCalledWith("run", "incomplete");
      });

      /** @scenario "A re-fold never replaces state from a history read missing an applied event" */
      it("keeps the loaded state for an out-of-order batch too", async () => {
        vi.useRealTimers();
        const strictExecutor = new FoldProjectionExecutor({
          refoldHistoryRetryDelaysMs: [],
        });
        const checkpointEvent = eventAt(CHECKPOINT_MS);
        const { fold } = makeAppliedFold({
          historyReads: [[eventAt(2_000), checkpointEvent]],
          appliedEventIds: ["evt-a", checkpointEvent.id],
        });

        const result = await strictExecutor.executeBatch(
          fold,
          [eventAt(3_000), eventAt(4_000)],
          context,
        );

        expect(result.sequence).toEqual([1_000, 2_000, CHECKPOINT_MS, 3_000, 4_000]);
        expect(refoldMetric).toHaveBeenCalledWith("run", "incomplete");
      });
    });

    describe("when a delivered event shares its occurred-at with a returned one", () => {
      interface IdState {
        ids: string[];
        LastEventOccurredAt: number;
      }

      /** Records the ids in fold order, which is what a tie decides. */
      function makeIdFold(history: Event[]) {
        const store = createMockFoldProjectionStore<IdState>();
        (store.get as ReturnType<typeof vi.fn>).mockResolvedValue({
          ids: [],
          LastEventOccurredAt: CHECKPOINT_MS,
        });
        const fold = createMockFoldProjectionDefinition("run", {
          store,
          init: () => ({ ids: [], LastEventOccurredAt: 0 }),
          apply: (state: IdState, event: Event): IdState => ({
            ids: [...state.ids, event.id],
            LastEventOccurredAt: Math.max(state.LastEventOccurredAt, event.occurredAt ?? 0),
          }),
        }) as FoldProjectionDefinition<IdState, Event>;
        fold.eventLoader = vi.fn().mockResolvedValue(history);
        return { fold, store };
      }

      /** One business time, two arrival times: the earlier arrival folds first. */
      const tiedEvent = ({ id, createdAt }: { id: string; createdAt: number }): Event => ({
        ...eventAt(3_000),
        id,
        createdAt,
        occurredAt: 3_000,
      });

      /** @scenario "Two events of the same business time replay in the order they arrived" */
      it("folds the event that arrived first before the one that arrived later", async () => {
        // The delivered event arrived BEFORE the one the read returned, so
        // appending it to the history is the order the merge has to correct.
        const returned = tiedEvent({ id: "evt-returned", createdAt: 2_000 });
        const delivered = tiedEvent({ id: "evt-delivered", createdAt: 1_000 });
        const { fold } = makeIdFold([returned, eventAt(CHECKPOINT_MS)]);

        const result = await executor.execute(fold, delivered, context);

        expect(result.ids.slice(0, 2)).toEqual(["evt-delivered", "evt-returned"]);
      });

      /** @scenario "Two events of the same business time replay in the order they arrived" */
      it("reaches the same state whichever side of the merge an event came from", async () => {
        const first = tiedEvent({ id: "evt-a", createdAt: 1_000 });
        const second = tiedEvent({ id: "evt-b", createdAt: 1_000 });
        const tail = eventAt(CHECKPOINT_MS);

        const readReturnedFirst = await executor.execute(
          makeIdFold([first, tail]).fold,
          second,
          context,
        );
        const readReturnedSecond = await executor.execute(
          makeIdFold([second, tail]).fold,
          first,
          context,
        );

        // Equal occurred-at AND equal created-at: the id is what keeps the
        // two replays from disagreeing.
        expect(readReturnedFirst.ids).toEqual(readReturnedSecond.ids);
        expect(readReturnedFirst.ids.slice(0, 2)).toEqual(["evt-a", "evt-b"]);
      });
    });

    describe("when the projection has opted out of re-folding", () => {
      /** @scenario "An order-insensitive fold never re-folds" */
      /** @scenario an out-of-order event is folded in place, not replayed */
      it("never reads the event log and applies the batch on top in occurredAt order", async () => {
        const { fold, eventLoader } = makeFold({
          storedState: { count: 99, LastEventOccurredAt: CHECKPOINT_MS },
          loadedEvents: [eventAt(1_000)],
          refoldOnOutOfOrder: false,
        });

        const result = await executor.executeBatch(fold, [eventAt(2_000), eventAt(1_000)], context);

        expect(eventLoader).not.toHaveBeenCalled();
        expect(result.count).toBe(101);
        // The batch was folded oldest-first, so the checkpoint never regresses.
        expect(result.LastEventOccurredAt).toBe(CHECKPOINT_MS);
        expect(refoldMetric).toHaveBeenCalledWith("counter", "declined");
      });

      /** @scenario "A single out-of-order event honours the same opt-out" */
      /** @scenario an out-of-order event is folded in place, not replayed */
      it("applies a lone out-of-order event on top without reading the event log", async () => {
        const { fold, eventLoader } = makeFold({
          storedState: { count: 99, LastEventOccurredAt: CHECKPOINT_MS },
          loadedEvents: [eventAt(1_000)],
          refoldOnOutOfOrder: false,
        });

        const result = await executor.execute(fold, eventAt(1_000), context);

        expect(eventLoader).not.toHaveBeenCalled();
        expect(result.count).toBe(100);
      });
    });

    describe("when no event loader is wired", () => {
      /** @scenario "An out-of-order batch with no event loader applies on top instead" */
      it("applies the batch on top and records the re-fold as unavailable", async () => {
        const { fold } = makeFold({
          storedState: { count: 99, LastEventOccurredAt: CHECKPOINT_MS },
          withEventLoader: false,
        });

        const result = await executor.executeBatch(fold, [eventAt(1_000), eventAt(2_000)], context);

        expect(result.count).toBe(101);
        expect(refoldMetric).toHaveBeenCalledWith("counter", "unavailable");
      });
    });
  });

  describe("given a batch that starts at or after the persisted checkpoint", () => {
    it("applies the batch without reading the event log", async () => {
      const { fold, eventLoader } = makeFold({
        storedState: { count: 1, LastEventOccurredAt: 1_000 },
      });

      const result = await executor.executeBatch(fold, [eventAt(2_000), eventAt(3_000)], context);

      expect(eventLoader).not.toHaveBeenCalled();
      expect(result.count).toBe(3);
    });
  });
});
