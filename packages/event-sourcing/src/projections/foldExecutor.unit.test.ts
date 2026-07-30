import { describe, expect, it, vi } from "vitest";
import { UndecodableStateError } from "../errors";
import type {
  CounterHandle,
  HistogramHandle,
  Metrics,
  MetricLabels,
} from "../ports/metrics";
import { createFoldExecutor } from "./foldExecutor";
import type { FoldDelivery } from "./foldExecutor";
import type {
  ReplaceStore,
  StateRead,
  StoreContext,
  StoredState,
} from "./store.types";

/**
 * The executor is the one place a fold's read-decide-write cycle happens, so
 * these tests are about the decisions that cycle makes on behalf of every fold
 * mounted onto it: genesis vs. found vs. undecodable, redelivery dedup by
 * sequence rather than event time, and that a batch is applied as the unit it
 * arrived as.
 */

interface TestState {
  readonly total: number;
  readonly applied: readonly number[];
}

type TestEvent = number;

function init(): TestState {
  return { total: 0, applied: [] };
}

function apply(state: TestState, event: TestEvent): TestState {
  return { total: state.total + event, applied: [...state.applied, event] };
}

function fakeStore(
  initial?: StoredState<TestState>,
): ReplaceStore<TestState> & { writes: StoredState<TestState>[] } {
  let stored = initial;
  const writes: StoredState<TestState>[] = [];
  return {
    kind: "replace",
    writes,
    async read(): Promise<StateRead<TestState>> {
      return stored === undefined ? { kind: "absent" } : { kind: "found", stored };
    },
    async write(_key, next: StoredState<TestState>): Promise<void> {
      stored = next;
      writes.push(next);
    },
  };
}

function fakeMetrics(): Metrics & {
  counterCalls: { labels: MetricLabels | undefined }[];
  histogramCalls: { value: number; labels: MetricLabels | undefined }[];
} {
  const counterCalls: { labels: MetricLabels | undefined }[] = [];
  const histogramCalls: { value: number; labels: MetricLabels | undefined }[] =
    [];
  return {
    counterCalls,
    histogramCalls,
    counter(): CounterHandle {
      return {
        inc: (labels) => {
          counterCalls.push({ labels });
        },
      };
    },
    histogram(): HistogramHandle {
      return {
        observe: (value, labels) => {
          histogramCalls.push({ value, labels });
        },
      };
    },
  };
}

function delivery(overrides: Partial<FoldDelivery<TestEvent>> = {}): FoldDelivery<TestEvent> {
  return {
    key: "trace-1",
    tenantId: "tenant-1",
    deliverySeq: 1,
    events: [1, 2, 3],
    ...overrides,
  };
}

describe("fold executor", () => {
  describe("given no stored state", () => {
    /** @scenario the first delivery for a key starts from the fold's genesis state */
    it("starts from init() and applies every event", async () => {
      const store = fakeStore();
      const executor = createFoldExecutor({
        store,
        init,
        apply,
        stateVersion: "v1",
        projectionName: "totals",
      });

      const outcome = await executor.apply(delivery());

      expect(outcome).toEqual({ kind: "applied", events: 3 });
      expect(store.writes).toEqual([
        { state: { total: 6, applied: [1, 2, 3] }, deliverySeq: 1, version: "v1" },
      ]);
    });
  });

  describe("given prior stored state", () => {
    /** @scenario a later delivery folds onto the existing state, not a fresh one */
    it("applies the batch on top of the stored state", async () => {
      const store = fakeStore({
        state: { total: 10, applied: [10] },
        deliverySeq: 1,
        version: "v1",
      });
      const executor = createFoldExecutor({
        store,
        init,
        apply,
        stateVersion: "v1",
        projectionName: "totals",
      });

      const outcome = await executor.apply(delivery({ deliverySeq: 2, events: [5] }));

      expect(outcome).toEqual({ kind: "applied", events: 1 });
      expect(store.writes).toEqual([
        { state: { total: 15, applied: [10, 5] }, deliverySeq: 2, version: "v1" },
      ]);
    });

    /** @scenario a redelivered job is recognised by sequence, not skipped by content */
    it("skips a redelivered job carrying the same sequence, without writing", async () => {
      const store = fakeStore({
        state: { total: 10, applied: [10] },
        deliverySeq: 2,
        version: "v1",
      });
      const executor = createFoldExecutor({
        store,
        init,
        apply,
        stateVersion: "v1",
        projectionName: "totals",
      });

      const outcome = await executor.apply(delivery({ deliverySeq: 2, events: [999] }));

      expect(outcome).toEqual({ kind: "skipped-redelivery", deliverySeq: 2 });
      expect(store.writes).toEqual([]);
    });

    it("skips a delivery whose sequence is lower than the stored one, without writing", async () => {
      const store = fakeStore({
        state: { total: 10, applied: [10] },
        deliverySeq: 5,
        version: "v1",
      });
      const executor = createFoldExecutor({
        store,
        init,
        apply,
        stateVersion: "v1",
        projectionName: "totals",
      });

      const outcome = await executor.apply(delivery({ deliverySeq: 3, events: [999] }));

      expect(outcome).toEqual({ kind: "skipped-redelivery", deliverySeq: 3 });
      expect(store.writes).toEqual([]);
    });
  });

  describe("given an undecodable stored row", () => {
    /** @scenario a shape change never overwrites unreadable state with a fresh accumulator */
    it("throws UndecodableStateError instead of treating the row as genesis", async () => {
      const store: ReplaceStore<TestState> & { writes: StoredState<TestState>[] } = {
        kind: "replace",
        writes: [],
        async read(): Promise<StateRead<TestState>> {
          return { kind: "undecodable", storedVersion: "v0", cause: new Error("bad shape") };
        },
        async write(_key, stored): Promise<void> {
          store.writes.push(stored);
        },
      };
      const executor = createFoldExecutor({
        store,
        init,
        apply,
        stateVersion: "v1",
        projectionName: "totals",
      });

      await expect(executor.apply(delivery())).rejects.toThrow(UndecodableStateError);
      await expect(executor.apply(delivery())).rejects.toMatchObject({
        context: {
          projectionName: "totals",
          aggregateId: "trace-1",
          storedVersion: "v0",
          expectedVersion: "v1",
        },
      });
      expect(store.writes).toEqual([]);
    });
  });

  describe("given a store write failure", () => {
    /** @scenario a failed write is never swallowed into a false "applied" outcome */
    it("propagates the error rather than reporting success", async () => {
      const store: ReplaceStore<TestState> = {
        kind: "replace",
        read: async () => ({ kind: "absent" }),
        write: async () => {
          throw new Error("store unavailable");
        },
      };
      const executor = createFoldExecutor({
        store,
        init,
        apply,
        stateVersion: "v1",
        projectionName: "totals",
      });

      await expect(executor.apply(delivery())).rejects.toThrow("store unavailable");
    });
  });

  describe("given a context object on the delivery", () => {
    /** @scenario the store sees the tenant and retention the delivery carried */
    it("passes tenantId and retentionDays through to the store call", async () => {
      const read = vi.fn(async (): Promise<StateRead<TestState>> => ({ kind: "absent" }));
      const write = vi.fn(async (): Promise<void> => undefined);
      const store: ReplaceStore<TestState> = { kind: "replace", read, write };
      const executor = createFoldExecutor({
        store,
        init,
        apply,
        stateVersion: "v1",
        projectionName: "totals",
      });

      await executor.apply(delivery({ retentionDays: 30 }));

      const expectedContext: StoreContext = { tenantId: "tenant-1", retentionDays: 30 };
      expect(read).toHaveBeenCalledWith("trace-1", expectedContext);
      expect(write).toHaveBeenCalledWith(
        "trace-1",
        expect.objectContaining({ deliverySeq: 1, version: "v1" }),
        expectedContext,
      );
    });
  });

  describe("when reporting metrics", () => {
    /** @scenario an applied delivery is distinguishable from a skipped one on the dashboard */
    it("counts an applied outcome and observes the batch size", async () => {
      const store = fakeStore();
      const metrics = fakeMetrics();
      const executor = createFoldExecutor({
        store,
        init,
        apply,
        stateVersion: "v1",
        projectionName: "totals",
        metrics,
      });

      await executor.apply(delivery({ events: [1, 2, 3, 4] }));

      expect(metrics.counterCalls).toEqual([
        { labels: { projection: "totals", kind: "applied" } },
      ]);
      expect(metrics.histogramCalls).toEqual([
        { value: 4, labels: { projection: "totals" } },
      ]);
    });

    it("counts a skipped-redelivery outcome without observing a batch size", async () => {
      const store = fakeStore({
        state: { total: 10, applied: [10] },
        deliverySeq: 5,
        version: "v1",
      });
      const metrics = fakeMetrics();
      const executor = createFoldExecutor({
        store,
        init,
        apply,
        stateVersion: "v1",
        projectionName: "totals",
        metrics,
      });

      await executor.apply(delivery({ deliverySeq: 5 }));

      expect(metrics.counterCalls).toEqual([
        { labels: { projection: "totals", kind: "skipped-redelivery" } },
      ]);
      expect(metrics.histogramCalls).toEqual([]);
    });
  });
});
