import { beforeEach, describe, expect, it, vi } from "vitest";
import { incrementEsFoldReadWindowFallbackTotal } from "../../metrics";

vi.mock("../../metrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../metrics")>();
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

function makeFold({
  readWindow,
  refoldable = false,
}: {
  readWindow?: { widthMs: number };
  /**
   * Pair `refoldOnStoreMiss` with a wired `eventLoaderUpTo`, which is the only
   * shape that may answer `undecodable`: rejecting a row is safe solely
   * because the history can rebuild it. The executor refuses to fold onto an
   * empty state otherwise.
   */
  refoldable?: boolean;
} = {}) {
  const store = createMockFoldProjectionStore<CounterState>();
  const fold = createMockFoldProjectionDefinition("windowed", {
    store,
    init: () => ({ count: 0, LastEventOccurredAt: 0 }),
    apply: (state: CounterState, event: Event) => ({
      count: state.count + 1,
      LastEventOccurredAt: Math.max(state.LastEventOccurredAt, event.occurredAt ?? 0),
    }),
    options: {
      refoldOnOutOfOrder: false,
      ...(readWindow ? { readWindow } : {}),
      ...(refoldable ? { refoldOnStoreMiss: true } : {}),
    },
  }) as FoldProjectionDefinition<CounterState, Event>;
  if (refoldable) {
    (
      fold as FoldProjectionDefinition<CounterState, Event> & {
        eventLoaderUpTo?: unknown;
      }
    ).eventLoaderUpTo = async () => [];
  }
  return { fold, store };
}

const fallbackMetric = incrementEsFoldReadWindowFallbackTotal as unknown as ReturnType<
  typeof vi.fn
>;

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
      /** @scenario a declared read window bounds the store read */
      it("bounds the store read to occurredAt ± widthMs and reads once", async () => {
        const { fold, store } = makeFold({ readWindow: { widthMs: WIDTH_MS } });
        (store.get as ReturnType<typeof vi.fn>).mockResolvedValue({
          count: 3,
          LastEventOccurredAt: OCCURRED_AT - 1,
        });

        const state = await executor.execute(fold, eventAt(OCCURRED_AT), context);

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
      /** @scenario a windowed miss retries unwindowed before treating the aggregate as new */
      it("retries once without the window and folds onto the recovered state", async () => {
        const { fold, store } = makeFold({ readWindow: { widthMs: WIDTH_MS } });
        (store.get as ReturnType<typeof vi.fn>).mockImplementation(
          async (_key: string, readContext: ProjectionStoreContext) =>
            readContext.readWindow === undefined
              ? { count: 7, LastEventOccurredAt: OCCURRED_AT - 1 }
              : null,
        );

        const state = await executor.execute(fold, eventAt(OCCURRED_AT), context);

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
      /** @scenario a genuinely new aggregate still starts empty */
      it("confirms the miss unwindowed and starts from an empty state", async () => {
        const { fold, store } = makeFold({ readWindow: { widthMs: WIDTH_MS } });

        const state = await executor.execute(fold, eventAt(OCCURRED_AT), context);

        expect(store.get).toHaveBeenCalledTimes(2);
        expect(state.count).toBe(1);
        expect(fallbackMetric).toHaveBeenCalledWith("windowed", "absent");
      });
    });

    describe("when the folded event has no usable business time", () => {
      /** @scenario an event without a usable business time reads unbounded */
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
          .mockImplementation(async (_key: string, readContext: ProjectionStoreContext) =>
            readContext.readWindow === undefined
              ? {
                  state: { count: 2, LastEventOccurredAt: OCCURRED_AT - 1 },
                  appliedEventIds: [],
                }
              : { state: null, appliedEventIds: [] },
          );
        store.getWithApplied = getWithApplied;

        const state = await executor.execute(fold, eventAt(OCCURRED_AT), context);

        expect(getWithApplied).toHaveBeenCalledTimes(2);
        expect(store.get).not.toHaveBeenCalled();
        expect(state.count).toBe(3);
        expect(fallbackMetric).toHaveBeenCalledWith("windowed", "recovered");
      });
    });

    describe("when the store found a row but refused it as undecodable", () => {
      /** @scenario a row the store found but refused is not read again unwindowed */
      it("does not re-read unwindowed, because a wider scope finds the same row", async () => {
        const { fold, store } = makeFold({
          readWindow: { widthMs: WIDTH_MS },
          refoldable: true,
        });
        // A history to rebuild FROM: an empty one is its own failure case,
        // covered below.
        (fold as typeof fold & { eventLoaderUpTo?: unknown }).eventLoaderUpTo = async () => [
          eventAt(OCCURRED_AT),
        ];
        const getWithApplied = vi.fn().mockResolvedValue({
          state: null,
          appliedEventIds: [],
          miss: "undecodable",
        });
        store.getWithApplied = getWithApplied;

        await executor.execute(fold, eventAt(OCCURRED_AT), context);

        // The retry exists to find a row OUTSIDE the window. This row was found
        // and rejected on its version, so re-reading unpruned only pays for the
        // same refusal.
        expect(getWithApplied).toHaveBeenCalledTimes(1);
        // And the window's own health signal stays about the window: a version
        // rejection counted as `absent` reads as "widen readWindow.widthMs".
        expect(fallbackMetric).not.toHaveBeenCalled();
      });
    });

    describe("when a refused row cannot be rebuilt from the log", () => {
      /** @scenario a state that cannot be read back is never quietly replaced by a partial one */
      it("fails loudly instead of folding onto an empty state", async () => {
        // No `refoldable`: the pairing that makes a rejection recoverable is
        // absent, which is what removing `refoldOnStoreMiss` on schedule — or
        // an unwired event loader — leaves behind.
        const { fold, store } = makeFold({ readWindow: { widthMs: WIDTH_MS } });
        store.getWithApplied = vi.fn().mockResolvedValue({
          state: null,
          appliedEventIds: [],
          miss: "undecodable",
        });

        await expect(executor.execute(fold, eventAt(OCCURRED_AT), context)).rejects.toThrow(
          /cannot decode/,
        );

        // The committed row survives: folding from `init()` would have written
        // a partial state stamped at the CURRENT version, which the gate that
        // just refused the row would accept from then on.
        expect(store.store).not.toHaveBeenCalled();
      });
    });

    describe("when a refused row's rebuild comes back empty", () => {
      /** @scenario a state that cannot be read back is never quietly replaced by a partial one */
      it("fails loudly rather than committing the partial fold it just built", async () => {
        // The refold path IS configured, so the first guard passes — but the
        // aggregate's history reads back empty (truncated log, retention
        // sweep), so the rebuild produces nothing. Falling through would
        // commit a partial state at the current version, which is the same
        // corruption by a different route.
        const { fold, store } = makeFold({
          readWindow: { widthMs: WIDTH_MS },
          refoldable: true,
        });
        // `makeFold`'s refoldable loader answers with no history at all.
        store.getWithApplied = vi.fn().mockResolvedValue({
          state: null,
          appliedEventIds: [],
          miss: "undecodable",
        });

        await expect(executor.execute(fold, eventAt(OCCURRED_AT), context)).rejects.toThrow(
          /produced no state/,
        );

        expect(store.store).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the fold declares no read window", () => {
    describe("when an event is folded", () => {
      /** @scenario a fold without a declared window reads unbounded */
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
