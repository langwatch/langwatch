import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FoldProjectionExecutor } from "../foldProjectionExecutor";
import {
  createMockFoldProjectionDefinition,
  createMockFoldProjectionStore,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import type { ProjectionStoreContext } from "../projectionStoreContext";
import type { Event } from "../../domain/types";

describe("FoldProjectionExecutor.execute", () => {
  const tenantId = createTestTenantId();
  let executor: FoldProjectionExecutor;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
    executor = new FoldProjectionExecutor();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("when no prior state exists", () => {
    it("initializes state and applies event", async () => {
      const store = createMockFoldProjectionStore<{ count: number }>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const foldDef = createMockFoldProjectionDefinition("counter", {
        store,
        init: () => ({ count: 0 }),
        apply: (state: { count: number }, _event: Event) => ({
          count: state.count + 1,
        }),
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
      );

      const context: ProjectionStoreContext = {
        aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
        tenantId,
      };

      const result = await executor.execute(foldDef, event, context);

      expect(result).toEqual({ count: 1 });
      // store.get receives the event's occurredAt as a read hint; store.store
      // still gets the original context.
      expect(store.get).toHaveBeenCalledWith(TEST_CONSTANTS.AGGREGATE_ID, {
        ...context,
        occurredAtMs: 1000000,
      });
      expect(store.store).toHaveBeenCalledWith({ count: 1 }, context);
    });
  });

  describe("when prior state exists", () => {
    it("loads existing state and applies event", async () => {
      const store = createMockFoldProjectionStore<{ count: number }>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 5 });

      const foldDef = createMockFoldProjectionDefinition("counter", {
        store,
        init: () => ({ count: 0 }),
        apply: (state: { count: number }, _event: Event) => ({
          count: state.count + 1,
        }),
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
      );

      const context: ProjectionStoreContext = {
        aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
        tenantId,
      };

      const result = await executor.execute(foldDef, event, context);

      expect(result).toEqual({ count: 6 });
      expect(store.store).toHaveBeenCalledWith({ count: 6 }, context);
    });
  });

  describe("when eventTypes is empty (all events)", () => {
    it("applies any event type", async () => {
      const store = createMockFoldProjectionStore<{ count: number }>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 2 });

      const foldDef = createMockFoldProjectionDefinition("counter", {
        store,
        init: () => ({ count: 0 }),
        apply: (state: { count: number }, _event: Event) => ({
          count: state.count + 1,
        }),
        eventTypes: [],
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
      );

      const context: ProjectionStoreContext = {
        aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
        tenantId,
      };

      const result = await executor.execute(foldDef, event, context);

      expect(result).toEqual({ count: 3 });
      expect(store.store).toHaveBeenCalledWith({ count: 3 }, context);
    });
  });

  describe("when event type does not match", () => {
    it("returns init state without loading or storing", async () => {
      const store = createMockFoldProjectionStore<{ count: number }>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 3 });

      const foldDef = createMockFoldProjectionDefinition("counter", {
        store,
        init: () => ({ count: 0 }),
        apply: (state: { count: number }, _event: Event) => ({
          count: state.count + 1,
        }),
        eventTypes: ["some.other.event"],
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
      );

      const context: ProjectionStoreContext = {
        aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
        tenantId,
      };

      const result = await executor.execute(foldDef, event, context);

      expect(result).toEqual({ count: 0 });
      expect(store.get).not.toHaveBeenCalled();
      expect(store.store).not.toHaveBeenCalled();
    });
  });

  describe("when custom key is provided in context", () => {
    it("uses the custom key for store.get", async () => {
      const store = createMockFoldProjectionStore<{ count: number }>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 10 });

      const foldDef = createMockFoldProjectionDefinition("counter", {
        store,
        init: () => ({ count: 0 }),
        apply: (state: { count: number }, _event: Event) => ({
          count: state.count + 1,
        }),
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
      );

      const context: ProjectionStoreContext = {
        aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
        tenantId,
        key: "custom-key-123",
      };

      const result = await executor.execute(foldDef, event, context);

      expect(result).toEqual({ count: 11 });
      expect(store.get).toHaveBeenCalledWith("custom-key-123", {
        ...context,
        occurredAtMs: 1000000,
      });
    });

    it("omits the occurredAt hint when the event has no occurredAt", async () => {
      const store = createMockFoldProjectionStore<{ count: number }>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

      const foldDef = createMockFoldProjectionDefinition("counter", {
        store,
        init: () => ({ count: 0 }),
        apply: (state: { count: number }, _event: Event) => ({
          count: state.count + 1,
        }),
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
      );
      // No usable occurredAt -> the context must be passed through unchanged.
      (event as { occurredAt?: number }).occurredAt = 0;

      const context: ProjectionStoreContext = {
        aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
        tenantId,
      };

      await executor.execute(foldDef, event, context);

      expect(store.get).toHaveBeenCalledWith(TEST_CONSTANTS.AGGREGATE_ID, context);
      const passedContext = (store.get as ReturnType<typeof vi.fn>).mock
        .calls[0]![1];
      expect(passedContext).not.toHaveProperty("occurredAtMs");
    });
  });
});

/** Accumulating state used by the batch tests: tracks count, the order events
 * were folded in, and the highest occurredAt (mirrors AbstractFoldProjection). */
interface BatchState {
  count: number;
  seen: string[];
  LastEventOccurredAt: number;
}

const batchInit = (): BatchState => ({ count: 0, seen: [], LastEventOccurredAt: 0 });
const batchApply = (state: BatchState, event: Event): BatchState => ({
  count: state.count + 1,
  seen: [...state.seen, event.id],
  LastEventOccurredAt: Math.max(state.LastEventOccurredAt, event.occurredAt ?? 0),
});

describe("FoldProjectionExecutor.executeBatch", () => {
  const tenantId = createTestTenantId();
  let executor: FoldProjectionExecutor;

  const context: ProjectionStoreContext = {
    aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
    tenantId,
  };

  const makeEvent = (occurredAt: number, id: string) =>
    createTestEvent(
      TEST_CONSTANTS.AGGREGATE_ID,
      TEST_CONSTANTS.AGGREGATE_TYPE,
      tenantId,
      undefined,
      occurredAt,
      undefined,
      {},
      id,
    );

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
    executor = new FoldProjectionExecutor();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("when folding several in-order events", () => {
    /** @scenario 'Folding several events reads once and stores once' */
    it("reads once, folds all, and stores once", async () => {
      const store = createMockFoldProjectionStore<BatchState>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const foldDef = createMockFoldProjectionDefinition("counter", {
        store,
        init: batchInit,
        apply: batchApply,
      });

      const events = [
        makeEvent(1000, "e1"),
        makeEvent(2000, "e2"),
        makeEvent(3000, "e3"),
      ];

      const result = await executor.executeBatch(foldDef, events, context);

      expect(result.count).toBe(3);
      expect(result.seen).toEqual(["e1", "e2", "e3"]);
      expect(store.get).toHaveBeenCalledTimes(1);
      expect(store.store).toHaveBeenCalledTimes(1);
      expect((store.store as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(result);
    });

    /** @scenario 'Coalesced fold equals sequential folding' */
    it("produces the same final state as sequential execute() calls", async () => {
      const events = [makeEvent(1000, "a"), makeEvent(2000, "b"), makeEvent(3000, "c")];

      const batchStore = createMockFoldProjectionStore<BatchState>();
      (batchStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const batchDef = createMockFoldProjectionDefinition("counter", {
        store: batchStore,
        init: batchInit,
        apply: batchApply,
      });
      const batched = await executor.executeBatch(batchDef, events, context);

      // Sequential path: each execute() re-reads the latest stored state.
      let current: BatchState | null = null;
      const seqStore = createMockFoldProjectionStore<BatchState>();
      (seqStore.get as ReturnType<typeof vi.fn>).mockImplementation(async () => current);
      (seqStore.store as ReturnType<typeof vi.fn>).mockImplementation(async (s: BatchState) => {
        current = s;
      });
      const seqDef = createMockFoldProjectionDefinition("counter", {
        store: seqStore,
        init: batchInit,
        apply: batchApply,
      });
      for (const event of events) {
        await executor.execute(seqDef, event, context);
      }

      expect(batched).toEqual(current);
    });
  });

  describe("when events arrive out of occurredAt order", () => {
    /** @scenario 'Out-of-order events are folded in occurredAt order' */
    it("folds them in occurredAt order", async () => {
      const store = createMockFoldProjectionStore<BatchState>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const foldDef = createMockFoldProjectionDefinition("counter", {
        store,
        init: batchInit,
        apply: batchApply,
      });

      const events = [makeEvent(3000, "third"), makeEvent(1000, "first"), makeEvent(2000, "second")];

      const result = await executor.executeBatch(foldDef, events, context);

      expect(result.seen).toEqual(["first", "second", "third"]);
    });
  });

  describe("when a single event matches", () => {
    it("delegates to execute() and stores once", async () => {
      const store = createMockFoldProjectionStore<BatchState>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const foldDef = createMockFoldProjectionDefinition("counter", {
        store,
        init: batchInit,
        apply: batchApply,
      });

      const result = await executor.executeBatch(foldDef, [makeEvent(1000, "only")], context);

      expect(result.count).toBe(1);
      expect(store.get).toHaveBeenCalledTimes(1);
      expect(store.store).toHaveBeenCalledTimes(1);
    });
  });

  describe("when no events match the projection's event types", () => {
    it("returns init state without loading or storing", async () => {
      const store = createMockFoldProjectionStore<BatchState>();
      const foldDef = createMockFoldProjectionDefinition("counter", {
        store,
        init: batchInit,
        apply: batchApply,
        eventTypes: ["some.other.event"],
      });

      const events = [makeEvent(1000, "x"), makeEvent(2000, "y")];

      const result = await executor.executeBatch(foldDef, events, context);

      expect(result).toEqual(batchInit());
      expect(store.get).not.toHaveBeenCalled();
      expect(store.store).not.toHaveBeenCalled();
    });
  });

  describe("when the batch starts before the persisted checkpoint", () => {
    it("re-folds from scratch via eventLoader", async () => {
      const store = createMockFoldProjectionStore<BatchState>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        count: 5,
        seen: ["old"],
        LastEventOccurredAt: 5000,
      });
      const foldDef = createMockFoldProjectionDefinition("counter", {
        store,
        init: batchInit,
        apply: batchApply,
      });
      foldDef.eventLoader = vi
        .fn()
        .mockResolvedValue([makeEvent(1000, "r1"), makeEvent(2000, "r2"), makeEvent(3000, "r3")]);

      // Batch's earliest occurredAt (1000) is before the checkpoint (5000).
      const events = [makeEvent(1000, "b1"), makeEvent(2000, "b2")];

      const result = await executor.executeBatch(foldDef, events, context);

      expect(foldDef.eventLoader).toHaveBeenCalledOnce();
      // Re-folded purely from the loaded history, not the stale checkpoint.
      expect(result.count).toBe(3);
      expect(result.seen).toEqual(["r1", "r2", "r3"]);
      expect(store.store).toHaveBeenCalledTimes(1);
    });

    it("applies on top of the checkpoint when no eventLoader is available", async () => {
      const store = createMockFoldProjectionStore<BatchState>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        count: 5,
        seen: ["old"],
        LastEventOccurredAt: 5000,
      });
      const foldDef = createMockFoldProjectionDefinition("counter", {
        store,
        init: batchInit,
        apply: batchApply,
      });

      const events = [makeEvent(1000, "b1"), makeEvent(2000, "b2")];

      const result = await executor.executeBatch(foldDef, events, context);

      // Degraded path mirrors execute(): batch folded onto the existing state.
      expect(result.count).toBe(7);
      expect(result.seen).toEqual(["old", "b1", "b2"]);
      expect(store.store).toHaveBeenCalledTimes(1);
    });
  });
});
