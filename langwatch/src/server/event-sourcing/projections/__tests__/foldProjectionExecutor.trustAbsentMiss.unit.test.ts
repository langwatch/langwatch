import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  incrementEsFoldAbsentMissTrustedTotal,
  incrementEsFoldReadWindowFallbackTotal,
} from "~/server/metrics";

vi.mock("~/server/metrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/metrics")>();
  return {
    ...actual,
    incrementEsFoldAbsentMissTrustedTotal: vi.fn(),
    incrementEsFoldReadWindowFallbackTotal: vi.fn(),
  };
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

/**
 * `trustAbsentMiss` is the executor half of the always-write contract: the
 * store always writes a row, so an ABSENT read proves the aggregate is new and
 * neither the unwindowed fallback read nor the `event_log` re-fold can find
 * anything — measured pre-change at ~290/min fallback scans with 0 recoveries
 * in 30 days and ~180/min re-folds at 93% zero yield. These tests pin the
 * skip to exactly the `absent` miss kind: `undecodable` keeps the full rescue
 * machinery, because there a complete row EXISTS.
 */
function makeFold({
  trustAbsentMiss = true,
  refoldable = false,
  history = [] as Event[],
}: {
  trustAbsentMiss?: boolean;
  refoldable?: boolean;
  history?: Event[];
} = {}) {
  const store = createMockFoldProjectionStore<CounterState>();
  const eventLoaderUpTo = vi.fn(async () => history);
  const fold = createMockFoldProjectionDefinition("trusted", {
    store,
    init: () => ({ count: 0, LastEventOccurredAt: 0 }),
    apply: (state: CounterState, event: Event) => ({
      count: state.count + 1,
      LastEventOccurredAt: Math.max(
        state.LastEventOccurredAt,
        event.occurredAt ?? 0,
      ),
    }),
    options: {
      refoldOnOutOfOrder: false,
      readWindow: { widthMs: WIDTH_MS },
      ...(trustAbsentMiss ? { trustAbsentMiss: true } : {}),
      ...(refoldable ? { refoldOnStoreMiss: true } : {}),
    },
  }) as FoldProjectionDefinition<CounterState, Event>;
  if (refoldable) {
    (
      fold as FoldProjectionDefinition<CounterState, Event> & {
        eventLoaderUpTo?: unknown;
      }
    ).eventLoaderUpTo = eventLoaderUpTo;
  }
  return { fold, store, eventLoaderUpTo };
}

const trustedMetric =
  incrementEsFoldAbsentMissTrustedTotal as unknown as ReturnType<typeof vi.fn>;
const fallbackMetric =
  incrementEsFoldReadWindowFallbackTotal as unknown as ReturnType<typeof vi.fn>;

describe("FoldProjectionExecutor trustAbsentMiss", () => {
  const tenantId = createTestTenantId();
  const context: ProjectionStoreContext = {
    aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
    tenantId,
  };
  const executor = new FoldProjectionExecutor();

  beforeEach(() => {
    trustedMetric.mockClear();
    fallbackMetric.mockClear();
  });

  afterEach(() => {
    delete process.env.ES_FOLD_TRUST_ABSENT_MISS;
  });

  const eventAt = (occurredAt: number) =>
    createTestEvent(
      TEST_CONSTANTS.AGGREGATE_ID,
      TEST_CONSTANTS.AGGREGATE_TYPE,
      tenantId,
      undefined,
      occurredAt,
    );

  describe("given a fold that trusts an absent miss", () => {
    describe("when the windowed read misses on a get()-only store", () => {
      /** @scenario a trusted absent miss reads once and folds from init */
      it("skips the unwindowed retry and folds from init()", async () => {
        const { fold, store } = makeFold();

        const state = await executor.execute(
          fold,
          eventAt(OCCURRED_AT),
          context,
        );

        expect(store.get).toHaveBeenCalledTimes(1);
        expect(state.count).toBe(1);
        // The fallback counter keeps meaning "the retry ran": a skipped retry
        // must not show up as `absent`, or the width-health signal drowns.
        expect(fallbackMetric).not.toHaveBeenCalled();
        expect(trustedMetric).toHaveBeenCalledWith("trusted", "fallback_read");
      });
    });

    describe("when the windowed read misses on a read-back store", () => {
      /** @scenario a trusted absent miss neither retries nor replays event_log */
      it("skips both the retry and the store-miss re-fold, and still commits", async () => {
        const { fold, store, eventLoaderUpTo } = makeFold({
          refoldable: true,
          history: [eventAt(OCCURRED_AT - 5_000)],
        });
        store.getWithApplied = vi.fn().mockResolvedValue({
          state: null,
          appliedEventIds: [],
          miss: "absent",
        });

        const state = await executor.execute(
          fold,
          eventAt(OCCURRED_AT),
          context,
        );

        expect(store.getWithApplied).toHaveBeenCalledTimes(1);
        // The whole point: event_log is not read for a trusted absence.
        expect(eventLoaderUpTo).not.toHaveBeenCalled();
        expect(state.count).toBe(1);
        expect(store.store).toHaveBeenCalledTimes(1);
        expect(trustedMetric).toHaveBeenCalledWith("trusted", "fallback_read");
        expect(trustedMetric).toHaveBeenCalledWith("trusted", "refold");
      });

      /** @scenario the batch path takes the same shortcut */
      it("takes the same shortcut for a coalesced batch", async () => {
        const { fold, store, eventLoaderUpTo } = makeFold({
          refoldable: true,
          history: [eventAt(OCCURRED_AT - 5_000)],
        });
        store.getWithApplied = vi.fn().mockResolvedValue({
          state: null,
          appliedEventIds: [],
          miss: "absent",
        });

        const state = await executor.executeBatch(
          fold,
          [eventAt(OCCURRED_AT), eventAt(OCCURRED_AT + 1_000)],
          context,
        );

        expect(store.getWithApplied).toHaveBeenCalledTimes(1);
        expect(eventLoaderUpTo).not.toHaveBeenCalled();
        expect(state.count).toBe(2);
      });
    });

    describe("when the store found a row but refused it as undecodable", () => {
      /** @scenario undecodable stays outside the trusted-absence claim */
      it("still re-folds from the event log — a complete row exists", async () => {
        const { fold, store, eventLoaderUpTo } = makeFold({
          refoldable: true,
          history: [eventAt(OCCURRED_AT - 5_000)],
        });
        store.getWithApplied = vi.fn().mockResolvedValue({
          state: null,
          appliedEventIds: [],
          miss: "undecodable",
        });

        const state = await executor.execute(
          fold,
          eventAt(OCCURRED_AT),
          context,
        );

        // The rescue machinery the flag retires for `absent` must survive for
        // `undecodable` — folding from init() here would write a PARTIAL state
        // stamped at the current version, laundering it past the version gate.
        expect(eventLoaderUpTo).toHaveBeenCalledTimes(1);
        expect(state.count).toBe(2); // history event + delivered event
        expect(trustedMetric).not.toHaveBeenCalled();
      });
    });

    describe("when the windowed read hits", () => {
      /** @scenario a hit is untouched by the option */
      it("folds onto the loaded state exactly as before", async () => {
        const { fold, store } = makeFold();
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
        expect(state.count).toBe(4);
        expect(trustedMetric).not.toHaveBeenCalled();
      });
    });

    describe("when the kill-switch env is set", () => {
      /** @scenario the kill switch restores the rescue machinery */
      it("restores the unwindowed retry and the re-fold without a code change", async () => {
        process.env.ES_FOLD_TRUST_ABSENT_MISS = "0";
        const { fold, store, eventLoaderUpTo } = makeFold({
          refoldable: true,
          history: [eventAt(OCCURRED_AT - 5_000)],
        });
        store.getWithApplied = vi.fn().mockResolvedValue({
          state: null,
          appliedEventIds: [],
          miss: "absent",
        });

        await executor.execute(fold, eventAt(OCCURRED_AT), context);

        expect(store.getWithApplied).toHaveBeenCalledTimes(2);
        expect(eventLoaderUpTo).toHaveBeenCalledTimes(1);
        expect(fallbackMetric).toHaveBeenCalledWith("trusted", "absent");
        expect(trustedMetric).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a fold that does NOT declare trustAbsentMiss", () => {
    describe("when the windowed read misses", () => {
      /** @scenario the default keeps the correctness net */
      it("keeps the unwindowed retry", async () => {
        const { fold, store } = makeFold({ trustAbsentMiss: false });

        await executor.execute(fold, eventAt(OCCURRED_AT), context);

        expect(store.get).toHaveBeenCalledTimes(2);
        expect(fallbackMetric).toHaveBeenCalledWith("trusted", "absent");
        expect(trustedMetric).not.toHaveBeenCalled();
      });
    });
  });
});
