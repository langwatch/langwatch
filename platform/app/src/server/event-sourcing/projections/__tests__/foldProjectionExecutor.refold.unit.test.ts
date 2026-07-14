import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { incrementEsFoldRefoldTotal } from "~/server/metrics";

vi.mock("~/server/metrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/metrics")>();
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
      LastEventOccurredAt: Math.max(
        state.LastEventOccurredAt,
        event.occurredAt ?? 0,
      ),
    }),
  }) as FoldProjectionDefinition<CounterState, Event>;

  const eventLoader = vi.fn().mockResolvedValue(loadedEvents ?? []);
  if (withEventLoader) fold.eventLoader = eventLoader;
  else fold.eventLoader = undefined;
  if (refoldOnOutOfOrder !== undefined) fold.options = { refoldOnOutOfOrder };

  return { fold, store, eventLoader };
}

const refoldMetric = incrementEsFoldRefoldTotal as unknown as ReturnType<
  typeof vi.fn
>;

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
        const history = [eventAt(1_000), eventAt(2_000), eventAt(CHECKPOINT_MS)];
        const { fold, store, eventLoader } = makeFold({
          storedState: { count: 99, LastEventOccurredAt: CHECKPOINT_MS },
          loadedEvents: history,
        });

        const result = await executor.executeBatch(
          fold,
          [eventAt(1_000), eventAt(2_000)],
          context,
        );

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

        const history = [eventAt(1_000), eventAt(2_000), eventAt(3_000)];
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

        const result = await executor.execute(
          fold,
          eventAt(1_000),
          context,
        );

        expect(result.sequence).toEqual([1_000, 2_000, 3_000]);
        expect(fold.eventLoader).toHaveBeenCalledOnce();
        expect(refoldMetric).toHaveBeenCalledWith("evaluation", "performed");
      });
    });

    describe("when the projection has opted out of re-folding", () => {
      /** @scenario "An order-insensitive fold never re-folds" */
      it("never reads the event log and applies the batch on top in occurredAt order", async () => {
        const { fold, eventLoader } = makeFold({
          storedState: { count: 99, LastEventOccurredAt: CHECKPOINT_MS },
          loadedEvents: [eventAt(1_000)],
          refoldOnOutOfOrder: false,
        });

        const result = await executor.executeBatch(
          fold,
          [eventAt(2_000), eventAt(1_000)],
          context,
        );

        expect(eventLoader).not.toHaveBeenCalled();
        expect(result.count).toBe(101);
        // The batch was folded oldest-first, so the checkpoint never regresses.
        expect(result.LastEventOccurredAt).toBe(CHECKPOINT_MS);
        expect(refoldMetric).toHaveBeenCalledWith("counter", "declined");
      });

      /** @scenario "A single out-of-order event honours the same opt-out" */
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

        const result = await executor.executeBatch(
          fold,
          [eventAt(1_000), eventAt(2_000)],
          context,
        );

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

      const result = await executor.executeBatch(
        fold,
        [eventAt(2_000), eventAt(3_000)],
        context,
      );

      expect(eventLoader).not.toHaveBeenCalled();
      expect(result.count).toBe(3);
    });
  });
});
