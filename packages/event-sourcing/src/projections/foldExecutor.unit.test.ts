import { describe, expect, it, vi } from "vitest";
import { UndecodableStateError } from "../errors";
import type {
  CounterHandle,
  HistogramHandle,
  MetricLabels,
  Metrics,
} from "../ports/metrics";
import type { FoldDelivery } from "./foldExecutor";
import { createFoldExecutor } from "./foldExecutor";
import type {
  ReplaceStore,
  StateRead,
  StoreContext,
  StoredState,
} from "./store.types";

/**
 * The executor is the one place a fold's read-decide-write cycle happens, so
 * these tests are about the decisions that cycle makes on behalf of every fold
 * mounted onto it: genesis vs. found vs. undecodable, that a batch is applied
 * as the unit it arrived as, and that a redelivery is simply applied again —
 * the fold is a function of the set of events, so nothing needs skipping.
 */

interface TestState {
  readonly highest: number;
  readonly seen: readonly number[];
}

type TestEvent = number;

function init(): TestState {
  return { highest: 0, seen: [] };
}

/** Set-union and max: idempotent and commutative, the admissible fold shape. */
function apply(state: TestState, event: TestEvent): TestState {
  return {
    highest: Math.max(state.highest, event),
    seen: state.seen.includes(event)
      ? state.seen
      : [...state.seen, event].sort((a, b) => a - b),
  };
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
      return stored === undefined
        ? { kind: "absent" }
        : { kind: "found", stored };
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

function delivery(
  overrides: Partial<FoldDelivery<TestEvent>> = {},
): FoldDelivery<TestEvent> {
  return {
    key: "trace-1",
    tenantId: "tenant-1",
    events: [1, 2, 3],
    ...overrides,
  };
}

describe("fold executor", () => {
  describe("given no stored state", () => {
    /** @scenario the first delivery for an aggregate starts from genesis */
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

      expect(outcome).toEqual({ events: 3 });
      expect(store.writes).toEqual([
        { state: { highest: 3, seen: [1, 2, 3] }, version: "v1" },
      ]);
    });
  });

  describe("given prior stored state", () => {
    /** @scenario a later delivery folds onto the stored state */
    it("applies the batch on top of the stored state", async () => {
      const store = fakeStore({
        state: { highest: 10, seen: [10] },
        version: "v1",
      });
      const executor = createFoldExecutor({
        store,
        init,
        apply,
        stateVersion: "v1",
        projectionName: "totals",
      });

      const outcome = await executor.apply(delivery({ events: [5] }));

      expect(outcome).toEqual({ events: 1 });
      expect(store.writes).toEqual([
        { state: { highest: 10, seen: [5, 10] }, version: "v1" },
      ]);
    });

    /** @scenario a redelivered delivery is applied again and reaches the same state */
    it("re-applies a redelivered batch rather than skipping it", async () => {
      const store = fakeStore();
      const executor = createFoldExecutor({
        store,
        init,
        apply,
        stateVersion: "v1",
        projectionName: "totals",
      });

      await executor.apply(delivery());
      await executor.apply(delivery());

      // Two writes, one state: nothing is skipped, and nothing needs to be.
      expect(store.writes).toHaveLength(2);
      expect(store.writes[0]).toEqual(store.writes[1]);
    });

    /** @scenario reading a row back and re-projecting it is a fixed point */
    it("reaches the same state again when re-projected with no new events", async () => {
      const stored = { state: { highest: 10, seen: [3, 10] }, version: "v1" };
      const store = fakeStore(stored);
      const executor = createFoldExecutor({
        store,
        init,
        apply,
        stateVersion: "v1",
        projectionName: "totals",
      });

      await executor.apply(delivery({ events: [] }));

      expect(store.writes).toEqual([stored]);
    });
  });

  describe("given one aggregate with no stored row and one with an undecodable one", () => {
    /** @scenario a genuinely missing row is genesis, and an undecodable one is not */
    it("starts the missing aggregate from genesis and fails the undecodable one instead of resetting it", async () => {
      const genesisStore = fakeStore();
      const genesisExecutor = createFoldExecutor({
        store: genesisStore,
        init,
        apply,
        stateVersion: "v1",
        projectionName: "totals",
      });

      const undecodableStore: ReplaceStore<TestState> & {
        writes: StoredState<TestState>[];
      } = {
        kind: "replace",
        writes: [],
        async read(): Promise<StateRead<TestState>> {
          return {
            kind: "undecodable",
            storedVersion: "v0",
            cause: new Error("bad shape"),
          };
        },
        async write(_key, stored): Promise<void> {
          undecodableStore.writes.push(stored);
        },
      };
      const undecodableExecutor = createFoldExecutor({
        store: undecodableStore,
        init,
        apply,
        stateVersion: "v1",
        projectionName: "totals",
      });

      const genesisOutcome = await genesisExecutor.apply(
        delivery({ key: "trace-genesis" }),
      );
      expect(genesisOutcome).toEqual({ events: 3 });
      expect(genesisStore.writes).toEqual([
        { state: { highest: 3, seen: [1, 2, 3] }, version: "v1" },
      ]);

      await expect(
        undecodableExecutor.apply(delivery({ key: "trace-undecodable" })),
      ).rejects.toThrow(UndecodableStateError);
      expect(undecodableStore.writes).toEqual([]);
    });
  });

  describe("given an undecodable stored row", () => {
    /** @scenario an unreadable row is never treated as an aggregate that has never been seen */
    it("throws UndecodableStateError instead of treating the row as genesis", async () => {
      const store: ReplaceStore<TestState> & {
        writes: StoredState<TestState>[];
      } = {
        kind: "replace",
        writes: [],
        async read(): Promise<StateRead<TestState>> {
          return {
            kind: "undecodable",
            storedVersion: "v0",
            cause: new Error("bad shape"),
          };
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

      await expect(executor.apply(delivery())).rejects.toThrow(
        UndecodableStateError,
      );
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
    /** @scenario a failed write is never reported as applied */
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

      await expect(executor.apply(delivery())).rejects.toThrow(
        "store unavailable",
      );
    });
  });

  describe("given a context object on the delivery", () => {
    /** @scenario the store sees the tenant and retention the delivery carried */
    it("passes tenantId and retentionDays through to the store call", async () => {
      const read = vi.fn(
        async (): Promise<StateRead<TestState>> => ({ kind: "absent" }),
      );
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

      const expectedContext: StoreContext = {
        tenantId: "tenant-1",
        retentionDays: 30,
      };
      expect(read).toHaveBeenCalledWith("trace-1", expectedContext);
      expect(write).toHaveBeenCalledWith(
        "trace-1",
        expect.objectContaining({ version: "v1" }),
        expectedContext,
      );
    });
  });

  describe("when reporting metrics", () => {
    /** @scenario an applied delivery is counted with its batch size */
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

    /** @scenario every failure lands on the same measure as a success */
    it("counts a failed store read", async () => {
      const store: ReplaceStore<TestState> = {
        kind: "replace",
        read: async () => {
          throw new Error("store unavailable");
        },
        write: async () => undefined,
      };
      const metrics = fakeMetrics();
      const executor = createFoldExecutor({
        store,
        init,
        apply,
        stateVersion: "v1",
        projectionName: "totals",
        metrics,
      });

      await expect(executor.apply(delivery())).rejects.toThrow(
        "store unavailable",
      );

      expect(metrics.counterCalls).toEqual([
        { labels: { projection: "totals", kind: "failed" } },
      ]);
    });

    it("counts a failed store write", async () => {
      const store: ReplaceStore<TestState> = {
        kind: "replace",
        read: async () => ({ kind: "absent" }),
        write: async () => {
          throw new Error("store unavailable");
        },
      };
      const metrics = fakeMetrics();
      const executor = createFoldExecutor({
        store,
        init,
        apply,
        stateVersion: "v1",
        projectionName: "totals",
        metrics,
      });

      await expect(executor.apply(delivery())).rejects.toThrow(
        "store unavailable",
      );

      expect(metrics.counterCalls).toEqual([
        { labels: { projection: "totals", kind: "failed" } },
      ]);
    });

    /** @scenario a fold that throws in its own apply is counted, not swallowed */
    it("counts a throwing apply rather than leaving the delivery uncounted", async () => {
      const store = fakeStore();
      const metrics = fakeMetrics();
      const executor = createFoldExecutor<TestState, TestEvent>({
        store,
        init,
        apply: () => {
          throw new Error("event 2 has no cost field");
        },
        stateVersion: "v1",
        projectionName: "totals",
        metrics,
      });

      await expect(executor.apply(delivery())).rejects.toThrow("no cost field");

      expect(metrics.counterCalls).toEqual([
        { labels: { projection: "totals", kind: "failed" } },
      ]);
      expect(store.writes).toEqual([]);
    });
  });
});
