import { describe, it, expect, vi } from "vitest";
import { replayEvents, FoldAccumulator } from "../replayExecutor";
import type { FoldProjectionDefinition } from "../../projections/foldProjection.types";
import type { ReplayEvent } from "../replayEventLoader";

/**
 * Helper: create a simple test fold projection with a spy store.
 * The store has `storeBatch` so replayEvents will use batch writes.
 */
function createTestProjection(opts?: { keyFn?: (event: any) => string }) {
  const storeBatchSpy = vi.fn().mockResolvedValue(undefined);

  const projection: FoldProjectionDefinition<
    { total: number; count: number },
    any
  > = {
    name: "testProjection",
    version: "2025-01-01",
    eventTypes: ["test.event"],
    init: () => ({ total: 0, count: 0 }),
    apply: (state, event) => ({
      total: state.total + (event.data?.value ?? 0),
      count: state.count + 1,
    }),
    store: {
      store: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      storeBatch: storeBatchSpy,
    },
    ...(opts?.keyFn ? { key: opts.keyFn } : {}),
  };

  return { projection, storeBatchSpy };
}

/** Helper: create a ReplayEvent with sensible defaults. */
function makeEvent(overrides: Partial<ReplayEvent> = {}): ReplayEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    aggregateId: "agg-1",
    aggregateType: "test",
    tenantId: "tenant-1",
    timestamp: Date.now(),
    occurredAt: Date.now(),
    type: "test.event",
    version: "2025-01-01",
    data: { value: 10 },
    ...overrides,
  };
}

describe("replayEvents", () => {
  it("folds events into accumulated state", async () => {
    const { projection, storeBatchSpy } = createTestProjection();
    const events = [
      makeEvent({ data: { value: 10 } }),
      makeEvent({ data: { value: 20 } }),
      makeEvent({ data: { value: 30 } }),
    ];

    const processed = await replayEvents({ projection, events });

    expect(processed).toBe(3);
    expect(storeBatchSpy).toHaveBeenCalledOnce();
    const batch = storeBatchSpy.mock.calls[0]![0] as Array<{
      state: { total: number; count: number };
      context: { aggregateId: string; tenantId: string; key: string };
    }>;
    expect(batch).toHaveLength(1); // One aggregate -> one entry
    expect(batch[0]!.state).toEqual({ total: 60, count: 3 });
  });

  it("calls onEvent callback for each event", async () => {
    const { projection } = createTestProjection();
    const onEvent = vi.fn();
    const events = [makeEvent(), makeEvent(), makeEvent()];

    await replayEvents({ projection, events, onEvent });

    expect(onEvent).toHaveBeenCalledTimes(3);
  });

  describe("when events span multiple aggregates", () => {
    it("produces separate state per aggregate", async () => {
      const { projection, storeBatchSpy } = createTestProjection();
      const events = [
        makeEvent({ aggregateId: "agg-A", data: { value: 10 } }),
        makeEvent({ aggregateId: "agg-B", data: { value: 20 } }),
        makeEvent({ aggregateId: "agg-A", data: { value: 30 } }),
      ];

      await replayEvents({ projection, events });

      // All events share the same tenantId, so storeBatch called once
      expect(storeBatchSpy).toHaveBeenCalledOnce();
      const batch = storeBatchSpy.mock.calls[0]![0] as Array<{
        state: { total: number; count: number };
        context: { aggregateId: string; tenantId: string; key: string };
      }>;
      expect(batch).toHaveLength(2);

      const stateA = batch.find((e) => e.context.aggregateId === "agg-A");
      const stateB = batch.find((e) => e.context.aggregateId === "agg-B");
      expect(stateA!.state).toEqual({ total: 40, count: 2 });
      expect(stateB!.state).toEqual({ total: 20, count: 1 });
    });
  });

  describe("when events span multiple tenants", () => {
    it("isolates state by tenant even with same aggregateId", async () => {
      const { projection, storeBatchSpy } = createTestProjection();
      const events = [
        makeEvent({
          tenantId: "tenant-A",
          aggregateId: "shared-agg",
          data: { value: 10 },
        }),
        makeEvent({
          tenantId: "tenant-B",
          aggregateId: "shared-agg",
          data: { value: 100 },
        }),
        makeEvent({
          tenantId: "tenant-A",
          aggregateId: "shared-agg",
          data: { value: 20 },
        }),
      ];

      await replayEvents({ projection, events });

      // storeBatch called once per tenant (2 tenants)
      expect(storeBatchSpy).toHaveBeenCalledTimes(2);

      const allEntries = storeBatchSpy.mock.calls.flatMap(
        (call: unknown[]) =>
          call[0] as Array<{
            state: { total: number; count: number };
            context: { aggregateId: string; tenantId: string };
          }>,
      );
      expect(allEntries).toHaveLength(2);

      const tenantAEntry = allEntries.find(
        (e) => String(e.context.tenantId) === "tenant-A",
      );
      const tenantBEntry = allEntries.find(
        (e) => String(e.context.tenantId) === "tenant-B",
      );

      expect(tenantAEntry!.state).toEqual({ total: 30, count: 2 });
      expect(tenantBEntry!.state).toEqual({ total: 100, count: 1 });
    });
  });

  describe("when projection has a custom key function", () => {
    it("groups events by custom key instead of aggregateId", async () => {
      const { projection, storeBatchSpy } = createTestProjection({
        keyFn: (event: ReplayEvent) =>
          `custom-${(event.data as { group: string }).group}`,
      });
      const events = [
        makeEvent({
          aggregateId: "agg-1",
          data: { value: 10, group: "X" },
        }),
        makeEvent({
          aggregateId: "agg-2",
          data: { value: 20, group: "X" },
        }),
        makeEvent({
          aggregateId: "agg-3",
          data: { value: 30, group: "Y" },
        }),
      ];

      await replayEvents({ projection, events });

      expect(storeBatchSpy).toHaveBeenCalledOnce();
      const batch = storeBatchSpy.mock.calls[0]![0] as Array<{
        state: { total: number; count: number };
        context: { key: string };
      }>;
      expect(batch).toHaveLength(2); // Two custom keys: custom-X and custom-Y

      const groupX = batch.find((e) => e.context.key === "custom-X");
      const groupY = batch.find((e) => e.context.key === "custom-Y");
      expect(groupX!.state).toEqual({ total: 30, count: 2 });
      expect(groupY!.state).toEqual({ total: 30, count: 1 });
    });
  });

  describe("when events list is empty", () => {
    it("returns zero processed and skips store", async () => {
      const { projection, storeBatchSpy } = createTestProjection();

      const processed = await replayEvents({ projection, events: [] });

      expect(processed).toBe(0);
      expect(storeBatchSpy).not.toHaveBeenCalled();
    });
  });

  describe("when writeBatchSize is smaller than entries", () => {
    it("chunks store calls by writeBatchSize", async () => {
      const { projection, storeBatchSpy } = createTestProjection();
      // Create events for 5 different aggregates (same tenant)
      const events = Array.from({ length: 5 }, (_, i) =>
        makeEvent({ aggregateId: `agg-${i}`, data: { value: i * 10 } }),
      );

      await replayEvents({ projection, events, writeBatchSize: 2 });

      // 5 entries in one tenant / batch of 2 = 3 calls (2 + 2 + 1)
      expect(storeBatchSpy).toHaveBeenCalledTimes(3);
      expect(storeBatchSpy.mock.calls[0]![0]).toHaveLength(2);
      expect(storeBatchSpy.mock.calls[1]![0]).toHaveLength(2);
      expect(storeBatchSpy.mock.calls[2]![0]).toHaveLength(1);
    });
  });

  describe("when replaying resets state from init()", () => {
    it("always starts from init state, never loads existing", async () => {
      const { projection, storeBatchSpy } = createTestProjection();
      const events = [
        makeEvent({ data: { value: 5 } }),
        makeEvent({ data: { value: 7 } }),
      ];

      await replayEvents({ projection, events });

      const batch = storeBatchSpy.mock.calls[0]![0] as Array<{
        state: { total: number; count: number };
      }>;
      // State is init() + both events, NOT loaded from store.get()
      expect(batch[0]!.state).toEqual({ total: 12, count: 2 });
      // store.get was never called (replay rebuilds from scratch)
      expect(projection.store.get).not.toHaveBeenCalled();
    });
  });
});

describe("FoldAccumulator", () => {
  it("accumulates events incrementally and flushes", async () => {
    const { projection, storeBatchSpy } = createTestProjection();
    const accumulator = new FoldAccumulator(projection);

    accumulator.apply(makeEvent({ data: { value: 10 } }));
    accumulator.apply(makeEvent({ data: { value: 20 } }));
    accumulator.apply(makeEvent({ data: { value: 30 } }));

    expect(accumulator.processed).toBe(3);
    expect(storeBatchSpy).not.toHaveBeenCalled();

    await accumulator.flush();

    expect(storeBatchSpy).toHaveBeenCalledOnce();
    const batch = storeBatchSpy.mock.calls[0]![0] as Array<{
      state: { total: number; count: number };
    }>;
    expect(batch[0]!.state).toEqual({ total: 60, count: 3 });
  });

  it("isolates state by tenant when fed interleaved events", async () => {
    const { projection, storeBatchSpy } = createTestProjection();
    const accumulator = new FoldAccumulator(projection);

    // Simulate interleaved events from two tenants (like streaming from CH)
    accumulator.apply(makeEvent({ tenantId: "t-A", aggregateId: "agg-1", data: { value: 10 } }));
    accumulator.apply(makeEvent({ tenantId: "t-B", aggregateId: "agg-1", data: { value: 100 } }));
    accumulator.apply(makeEvent({ tenantId: "t-A", aggregateId: "agg-1", data: { value: 20 } }));

    await accumulator.flush();

    const allEntries = storeBatchSpy.mock.calls.flatMap(
      (call: unknown[]) => call[0] as Array<{ state: { total: number }; context: { tenantId: string } }>,
    );
    expect(allEntries).toHaveLength(2);

    const tA = allEntries.find((e) => String(e.context.tenantId) === "t-A");
    const tB = allEntries.find((e) => String(e.context.tenantId) === "t-B");
    expect(tA!.state).toEqual({ total: 30, count: 2 });
    expect(tB!.state).toEqual({ total: 100, count: 1 });
  });

  describe("when no events are applied", () => {
    it("skips store on flush", async () => {
      const { projection, storeBatchSpy } = createTestProjection();
      const accumulator = new FoldAccumulator(projection);

      await accumulator.flush();

      expect(accumulator.processed).toBe(0);
      expect(storeBatchSpy).not.toHaveBeenCalled();
    });
  });
});
