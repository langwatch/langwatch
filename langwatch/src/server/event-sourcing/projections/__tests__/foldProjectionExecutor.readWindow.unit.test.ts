import { beforeEach, describe, expect, it, vi } from "vitest";
import { incrementEsFoldReadWindowFallbackTotal } from "~/server/metrics";

vi.mock("~/server/metrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/metrics")>();
  return { ...actual, incrementEsFoldReadWindowFallbackTotal: vi.fn() };
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

interface CounterState {
  count: number;
  LastEventOccurredAt: number;
}

const WIDTH_MS = 60_000;
const OCCURRED_AT = 1_700_000_000_000;

function makeFold({ readWindow }: { readWindow?: { widthMs: number } } = {}) {
  const store = createMockFoldProjectionStore<CounterState>();
  const fold = createMockFoldProjectionDefinition("windowed", {
    store,
    init: () => ({ count: 0, LastEventOccurredAt: 0 }),
    apply: (state: CounterState, event: Event) => ({
      count: state.count + 1,
      LastEventOccurredAt: Math.max(
        state.LastEventOccurredAt,
        event.occurredAt ?? 0,
      ),
    }),
    options: { refoldOnOutOfOrder: false, ...(readWindow ? { readWindow } : {}) },
  }) as FoldProjectionDefinition<CounterState, Event>;
  return { fold, store };
}

const fallbackMetric =
  incrementEsFoldReadWindowFallbackTotal as unknown as ReturnType<typeof vi.fn>;

describe("FoldProjectionExecutor declared read window", () => {
  const tenantId = createTestTenantId();
  const context: ProjectionStoreContext = {
    aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
    tenantId,
  };
  const executor = new FoldProjectionExecutor();

  beforeEach(() => {
    fallbackMetric.mockClear();
  });

  const eventAt = (occurredAt: number) =>
    createTestEvent(
      TEST_CONSTANTS.AGGREGATE_ID,
      TEST_CONSTANTS.AGGREGATE_TYPE,
      tenantId,
      undefined,
      occurredAt,
    );

  describe("given the fold declares a read window", () => {
    describe("when the windowed read hits", () => {
      it("bounds the store read to occurredAt ± widthMs and reads once", async () => {
        const { fold, store } = makeFold({ readWindow: { widthMs: WIDTH_MS } });
        (store.get as ReturnType<typeof vi.fn>).mockResolvedValue({
          count: 3,
          LastEventOccurredAt: OCCURRED_AT - 1,
        });

        const state = await executor.execute(
          fold,
          eventAt(OCCURRED_AT),
          context,
        );

        expect(store.get).toHaveBeenCalledTimes(1);
        expect(store.get).toHaveBeenCalledWith(
          TEST_CONSTANTS.AGGREGATE_ID,
          expect.objectContaining({
            occurredAtMs: OCCURRED_AT,
            readWindow: {
              fromMs: OCCURRED_AT - WIDTH_MS,
              toMs: OCCURRED_AT + WIDTH_MS,
            },
          }),
        );
        expect(state.count).toBe(4);
        expect(fallbackMetric).not.toHaveBeenCalled();
      });
    });

    describe("when the windowed read misses a row that exists outside the window", () => {
      it("retries once without the window and folds onto the recovered state", async () => {
        const { fold, store } = makeFold({ readWindow: { widthMs: WIDTH_MS } });
        (store.get as ReturnType<typeof vi.fn>).mockImplementation(
          async (_key: string, readContext: ProjectionStoreContext) =>
            readContext.readWindow === undefined
              ? { count: 7, LastEventOccurredAt: OCCURRED_AT - 1 }
              : null,
        );

        const state = await executor.execute(
          fold,
          eventAt(OCCURRED_AT),
          context,
        );

        expect(store.get).toHaveBeenCalledTimes(2);
        const retryContext = (store.get as ReturnType<typeof vi.fn>).mock
          .calls[1]![1] as ProjectionStoreContext;
        expect(retryContext.readWindow).toBeUndefined();
        // The windowed attempt consulted the cache moments ago — the retry
        // goes straight to the durable tier.
        expect(retryContext.bypassReadCache).toBe(true);
        // The recovered row is folded onto — not replaced by a batch on init().
        expect(state.count).toBe(8);
        expect(fallbackMetric).toHaveBeenCalledWith("windowed", "recovered");
      });
    });

    describe("when the aggregate is genuinely new", () => {
      it("confirms the miss unwindowed and starts from an empty state", async () => {
        const { fold, store } = makeFold({ readWindow: { widthMs: WIDTH_MS } });

        const state = await executor.execute(
          fold,
          eventAt(OCCURRED_AT),
          context,
        );

        expect(store.get).toHaveBeenCalledTimes(2);
        expect(state.count).toBe(1);
        expect(fallbackMetric).toHaveBeenCalledWith("windowed", "absent");
      });
    });

    describe("when the folded event has no usable business time", () => {
      it("reads unbounded", async () => {
        const { fold, store } = makeFold({ readWindow: { widthMs: WIDTH_MS } });

        await executor.execute(fold, eventAt(0), context);

        expect(store.get).toHaveBeenCalledTimes(1);
        const readContext = (store.get as ReturnType<typeof vi.fn>).mock
          .calls[0]![1] as ProjectionStoreContext;
        expect(readContext.readWindow).toBeUndefined();
        expect(fallbackMetric).not.toHaveBeenCalled();
      });
    });

    describe("when a batch's windowed read misses a row that exists outside the window", () => {
      it("retries once without the window and folds the batch onto the recovered state", async () => {
        const { fold, store } = makeFold({ readWindow: { widthMs: WIDTH_MS } });
        (store.get as ReturnType<typeof vi.fn>).mockImplementation(
          async (_key: string, readContext: ProjectionStoreContext) =>
            readContext.readWindow === undefined
              ? { count: 10, LastEventOccurredAt: OCCURRED_AT - 1 }
              : null,
        );

        const state = await executor.executeBatch(
          fold,
          [eventAt(OCCURRED_AT), eventAt(OCCURRED_AT + 1_000)],
          context,
        );

        expect(store.get).toHaveBeenCalledTimes(2);
        const retryContext = (store.get as ReturnType<typeof vi.fn>).mock
          .calls[1]![1] as ProjectionStoreContext;
        expect(retryContext.readWindow).toBeUndefined();
        expect(retryContext.bypassReadCache).toBe(true);
        expect(state.count).toBe(12);
        expect(fallbackMetric).toHaveBeenCalledWith("windowed", "recovered");
      });
    });

    describe("when a batch is folded", () => {
      it("anchors the window on the batch's earliest event", async () => {
        const { fold, store } = makeFold({ readWindow: { widthMs: WIDTH_MS } });
        (store.get as ReturnType<typeof vi.fn>).mockResolvedValue({
          count: 0,
          LastEventOccurredAt: 0,
        });

        await executor.executeBatch(
          fold,
          [eventAt(OCCURRED_AT + 5_000), eventAt(OCCURRED_AT)],
          context,
        );

        expect(store.get).toHaveBeenCalledWith(
          TEST_CONSTANTS.AGGREGATE_ID,
          expect.objectContaining({
            readWindow: {
              fromMs: OCCURRED_AT - WIDTH_MS,
              toMs: OCCURRED_AT + WIDTH_MS,
            },
          }),
        );
      });
    });
  });

  describe("given the fold's store serves getWithApplied (cached store)", () => {
    describe("when the windowed read misses", () => {
      it("routes the unwindowed retry through the same read path", async () => {
        const { fold, store } = makeFold({ readWindow: { widthMs: WIDTH_MS } });
        const getWithApplied = vi
          .fn()
          .mockImplementation(
            async (_key: string, readContext: ProjectionStoreContext) =>
              readContext.readWindow === undefined
                ? {
                    state: { count: 2, LastEventOccurredAt: OCCURRED_AT - 1 },
                    appliedEventIds: [],
                  }
                : { state: null, appliedEventIds: [] },
          );
        store.getWithApplied = getWithApplied;

        const state = await executor.execute(
          fold,
          eventAt(OCCURRED_AT),
          context,
        );

        expect(getWithApplied).toHaveBeenCalledTimes(2);
        expect(store.get).not.toHaveBeenCalled();
        expect(state.count).toBe(3);
        expect(fallbackMetric).toHaveBeenCalledWith("windowed", "recovered");
      });
    });
  });

  describe("given the fold declares no read window", () => {
    describe("when an event is folded", () => {
      it("reads once without a window and never retries a miss", async () => {
        const { fold, store } = makeFold();

        await executor.execute(fold, eventAt(OCCURRED_AT), context);

        expect(store.get).toHaveBeenCalledTimes(1);
        const readContext = (store.get as ReturnType<typeof vi.fn>).mock
          .calls[0]![1] as ProjectionStoreContext;
        expect(readContext.readWindow).toBeUndefined();
        expect(readContext.occurredAtMs).toBe(OCCURRED_AT);
        expect(fallbackMetric).not.toHaveBeenCalled();
      });
    });
  });
});
