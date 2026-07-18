import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  incrementEsFoldStoreMissRefoldTotal,
  observeEsFoldStoreMissRefoldEvents,
} from "~/server/metrics";

vi.mock("~/server/metrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/metrics")>();
  return {
    ...actual,
    incrementEsFoldStoreMissRefoldTotal: vi.fn(),
    observeEsFoldStoreMissRefoldEvents: vi.fn(),
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
import { FoldProjectionExecutor } from "../foldProjectionExecutor";
import type { ProjectionStoreContext } from "../projectionStoreContext";

/**
 * `options.refoldOnStoreMiss` — the continuity mechanism for folds whose
 * persisted row cannot be read back into fold state (lossy analytics rows,
 * ADR-034). On a store miss the executor rebuilds state from the event log
 * up to the delivered event instead of folding only the delivered batch.
 */
describe("FoldProjectionExecutor refoldOnStoreMiss", () => {
  const tenantId = createTestTenantId();
  let executor: FoldProjectionExecutor;

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

  function makeEvent(id: string, createdAt: number): Event {
    return createTestEvent(
      TEST_CONSTANTS.AGGREGATE_ID,
      TEST_CONSTANTS.AGGREGATE_TYPE,
      tenantId,
      undefined,
      createdAt,
      undefined,
      {},
      id,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new FoldProjectionExecutor();
  });

  describe("given the store misses and the option is enabled", () => {
    it("re-folds from the loaded history instead of only the delivered event", async () => {
      const e1 = makeEvent("e1", 1000);
      const e2 = makeEvent("e2", 2000);
      const store = createMockFoldProjectionStore<CountState>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const foldDef = createMockFoldProjectionDefinition("slim", {
        store,
        init,
        apply,
        options: { refoldOnStoreMiss: true },
      });
      foldDef.eventLoaderUpTo = vi.fn().mockResolvedValue([e1, e2]);

      const result = (await executor.execute(
        foldDef,
        e2,
        context,
      )) as CountState;

      // History (e1) is included — NOT just the delivered e2.
      expect(result.ids).toEqual(["e1", "e2"]);
      expect(foldDef.eventLoaderUpTo).toHaveBeenCalledWith({
        tenantId,
        aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
        upToEvent: e2,
      });
      expect(store.store).toHaveBeenCalledWith(result, context);
      expect(incrementEsFoldStoreMissRefoldTotal).toHaveBeenCalledWith({
        projectionName: "slim",
        kind: "resumed",
      });
      expect(observeEsFoldStoreMissRefoldEvents).toHaveBeenCalledWith({
        projectionName: "slim",
        eventCount: 2,
      });
    });

    it("does not double-apply the delivered event when the history already contains it", async () => {
      const e1 = makeEvent("e1", 1000);
      const store = createMockFoldProjectionStore<CountState>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const foldDef = createMockFoldProjectionDefinition("slim", {
        store,
        init,
        apply,
        options: { refoldOnStoreMiss: true },
      });
      foldDef.eventLoaderUpTo = vi.fn().mockResolvedValue([e1]);

      const result = (await executor.execute(
        foldDef,
        e1,
        context,
      )) as CountState;

      expect(result.ids).toEqual(["e1"]);
      expect(incrementEsFoldStoreMissRefoldTotal).toHaveBeenCalledWith({
        projectionName: "slim",
        kind: "first_touch",
      });
      expect(observeEsFoldStoreMissRefoldEvents).toHaveBeenCalledWith({
        projectionName: "slim",
        eventCount: 1,
      });
    });

    it("applies the delivered event on top when the history read lags behind it", async () => {
      const e1 = makeEvent("e1", 1000);
      const e2 = makeEvent("e2", 2000);
      const store = createMockFoldProjectionStore<CountState>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const foldDef = createMockFoldProjectionDefinition("slim", {
        store,
        init,
        apply,
        options: { refoldOnStoreMiss: true },
      });
      // e2 was persisted but the event-log read hasn't caught up to it.
      foldDef.eventLoaderUpTo = vi.fn().mockResolvedValue([e1]);

      const result = (await executor.execute(
        foldDef,
        e2,
        context,
      )) as CountState;

      expect(result.ids).toEqual(["e1", "e2"]);
    });

    it("falls through to plain init+apply when the history read returns nothing", async () => {
      const e1 = makeEvent("e1", 1000);
      const store = createMockFoldProjectionStore<CountState>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const foldDef = createMockFoldProjectionDefinition("slim", {
        store,
        init,
        apply,
        options: { refoldOnStoreMiss: true },
      });
      foldDef.eventLoaderUpTo = vi.fn().mockResolvedValue([]);

      const result = (await executor.execute(
        foldDef,
        e1,
        context,
      )) as CountState;

      expect(result.ids).toEqual(["e1"]);
      expect(store.store).toHaveBeenCalled();
    });

    it("propagates a failed history read so the queue retries the delivery", async () => {
      const e1 = makeEvent("e1", 1000);
      const store = createMockFoldProjectionStore<CountState>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const foldDef = createMockFoldProjectionDefinition("slim", {
        store,
        init,
        apply,
        options: { refoldOnStoreMiss: true },
      });
      foldDef.eventLoaderUpTo = vi
        .fn()
        .mockRejectedValue(new Error("event_log unavailable"));

      await expect(executor.execute(foldDef, e1, context)).rejects.toThrow(
        "event_log unavailable",
      );
      expect(store.store).not.toHaveBeenCalled();
    });
  });

  describe("given the store has state", () => {
    it("never consults the event log", async () => {
      const e2 = makeEvent("e2", 2000);
      const store = createMockFoldProjectionStore<CountState>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        ids: ["e1"],
        LastEventOccurredAt: 1000,
      });

      const foldDef = createMockFoldProjectionDefinition("slim", {
        store,
        init,
        apply,
        options: { refoldOnStoreMiss: true },
      });
      foldDef.eventLoaderUpTo = vi.fn();

      const result = (await executor.execute(
        foldDef,
        e2,
        context,
      )) as CountState;

      expect(result.ids).toEqual(["e1", "e2"]);
      expect(foldDef.eventLoaderUpTo).not.toHaveBeenCalled();
    });
  });

  describe("given the option is not set", () => {
    it("keeps the legacy init+apply behaviour on a store miss", async () => {
      const e2 = makeEvent("e2", 2000);
      const store = createMockFoldProjectionStore<CountState>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const foldDef = createMockFoldProjectionDefinition("slim", {
        store,
        init,
        apply,
      });
      foldDef.eventLoaderUpTo = vi.fn();

      const result = (await executor.execute(
        foldDef,
        e2,
        context,
      )) as CountState;

      expect(result.ids).toEqual(["e2"]);
      expect(foldDef.eventLoaderUpTo).not.toHaveBeenCalled();
    });
  });

  describe("given the option is enabled but no eventLoaderUpTo is wired", () => {
    // `shouldRefoldOnMiss` requires BOTH the option and the loader. A
    // projection that opts in without a loader must degrade to plain
    // init+apply rather than throw — otherwise a wiring omission takes the
    // pipeline down instead of merely losing the continuity optimisation.
    it("degrades gracefully to init+apply on a store miss", async () => {
      const e2 = makeEvent("e2", 2000);
      const store = createMockFoldProjectionStore<CountState>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const foldDef = createMockFoldProjectionDefinition("slim", {
        store,
        init,
        apply,
        options: { refoldOnStoreMiss: true },
      });
      foldDef.eventLoaderUpTo = undefined;

      const result = (await executor.execute(
        foldDef,
        e2,
        context,
      )) as CountState;

      expect(result.ids).toEqual(["e2"]);
      expect(store.store).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a coalesced batch arrives on a store miss", () => {
    it("re-folds once up to the log-latest delivered event and applies none of them twice", async () => {
      const e1 = makeEvent("e1", 1000);
      const e2 = makeEvent("e2", 2000);
      const e3 = makeEvent("e3", 3000);
      const store = createMockFoldProjectionStore<CountState>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const foldDef = createMockFoldProjectionDefinition("slim", {
        store,
        init,
        apply,
        options: { refoldOnStoreMiss: true },
      });
      foldDef.eventLoaderUpTo = vi.fn().mockResolvedValue([e1, e2, e3]);

      const result = (await executor.executeBatch(
        foldDef,
        [e2, e3],
        context,
      )) as CountState;

      expect(foldDef.eventLoaderUpTo).toHaveBeenCalledTimes(1);
      expect(foldDef.eventLoaderUpTo).toHaveBeenCalledWith({
        tenantId,
        aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
        upToEvent: e3,
      });
      expect(result.ids).toEqual(["e1", "e2", "e3"]);
      expect(store.store).toHaveBeenCalledWith(result, context);
      expect(incrementEsFoldStoreMissRefoldTotal).toHaveBeenCalledWith({
        projectionName: "slim",
        kind: "resumed",
      });
      expect(observeEsFoldStoreMissRefoldEvents).toHaveBeenCalledWith({
        projectionName: "slim",
        eventCount: 3,
      });
    });

    it("records first-touch when history contains exactly the delivered batch", async () => {
      const e1 = makeEvent("e1", 1000);
      const e2 = makeEvent("e2", 2000);
      const store = createMockFoldProjectionStore<CountState>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const foldDef = createMockFoldProjectionDefinition("slim", {
        store,
        init,
        apply,
        options: { refoldOnStoreMiss: true },
      });
      foldDef.eventLoaderUpTo = vi.fn().mockResolvedValue([e1, e2]);

      await executor.executeBatch(foldDef, [e1, e2], context);

      expect(incrementEsFoldStoreMissRefoldTotal).toHaveBeenCalledWith({
        projectionName: "slim",
        kind: "first_touch",
      });
      expect(observeEsFoldStoreMissRefoldEvents).toHaveBeenCalledWith({
        projectionName: "slim",
        eventCount: 2,
      });
    });

    it("merges a delivered event missing from the middle of the history back into occurredAt order", async () => {
      const e1 = makeEvent("e1", 1000);
      const e2 = makeEvent("e2", 2000);
      const e3 = makeEvent("e3", 3000);
      const store = createMockFoldProjectionStore<CountState>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const foldDef = createMockFoldProjectionDefinition("slim", {
        store,
        init,
        apply,
        options: { refoldOnStoreMiss: true },
      });
      // The history read lags on e2 only — it must NOT be applied last.
      foldDef.eventLoaderUpTo = vi.fn().mockResolvedValue([e1, e3]);

      const result = (await executor.executeBatch(
        foldDef,
        [e1, e2, e3],
        context,
      )) as CountState;

      expect(result.ids).toEqual(["e1", "e2", "e3"]);
    });
  });
});
