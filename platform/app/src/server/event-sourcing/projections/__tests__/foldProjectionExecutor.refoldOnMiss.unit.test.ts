import { register } from "prom-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
    return createTestEvent({
      aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
      aggregateType: TEST_CONSTANTS.AGGREGATE_TYPE,
      tenantId,
      createdAt,
      data: {},
      id,
    });
  }

  beforeEach(() => {
    executor = new FoldProjectionExecutor();
  });

  describe("given the store misses and the option is enabled", () => {
    /** @scenario a stored state written under an older shape is rebuilt rather than trusted */
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
      expect(store.store).toHaveBeenCalledWith(
        result,
        expect.objectContaining({ aggregateId: context.aggregateId }),
      );
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
    /** @scenario a cold cache recovers state from the store, not the event log */
    /** @scenario the event log is read only for a deliberate rebuild */
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
    // The default is OFF, and this pins it: a fold that never opts in must not
    // reach event_log, whatever the executor's gate is later rewritten to. An
    // unbounded history scan is the expensive path (ADR-066), so it stays
    // opt-in — a fold earns continuity by persisting read-back state instead.
    /** @scenario a brand-new aggregate starts from an empty state */
    it("starts from init+apply on a store miss without reading the event log", async () => {
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
      expect(store.store).toHaveBeenCalledWith(
        result,
        expect.objectContaining({ aggregateId: context.aggregateId }),
      );
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

/**
 * The ADR-066 transitional net has to be observable.
 *
 * `refoldOnStoreMiss` survives on three folds solely to rebuild aggregates whose
 * committed row predates their read-back columns, and its deletion condition is
 * "it stopped firing". Without a counter that is an assumption; worse, a
 * transitional refold and a regression to the pre-ADR-066 steady state (every
 * cache miss walking `event_log` — the 2026-07-23 `TOO_MANY_PARTS` outage) are
 * indistinguishable from the outside.
 */
describe("FoldProjectionExecutor refoldOnStoreMiss instrumentation", () => {
  const tenantId = createTestTenantId();
  const context: ProjectionStoreContext = {
    aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
    tenantId,
  };

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

  async function refoldCount(
    projectionName: string,
    outcome: string,
  ): Promise<number> {
    const metric = register.getSingleMetric("es_fold_refold_on_miss_total");
    if (!metric) return 0;
    const snapshot = await metric.get();
    return (
      snapshot.values.find(
        (value) =>
          value.labels.projection_name === projectionName &&
          value.labels.outcome === outcome,
      )?.value ?? 0
    );
  }

  function missingStoreFold(name: string) {
    const store = createMockFoldProjectionStore<CountState>();
    (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    return createMockFoldProjectionDefinition(name, {
      store,
      init,
      apply,
      options: { refoldOnStoreMiss: true },
    });
  }

  describe("given a store miss on an aggregate with history", () => {
    describe("when the executor re-folds it", () => {
      it("counts the refold as performed", async () => {
        const executor = new FoldProjectionExecutor();
        const event = createTestEvent({
          aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
          aggregateType: TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
          createdAt: 2000,
          data: {},
          id: "e2",
        });
        const foldDef = missingStoreFold("counted-performed");
        foldDef.eventLoaderUpTo = vi.fn().mockResolvedValue([event]);
        const before = await refoldCount("counted-performed", "performed");

        await executor.execute(foldDef, event, context);

        expect(await refoldCount("counted-performed", "performed")).toBe(
          before + 1,
        );
      });
    });
  });

  describe("given a store miss on an aggregate with no history", () => {
    describe("when the executor falls through to init", () => {
      it("counts it as absent rather than as transitional debt", async () => {
        const executor = new FoldProjectionExecutor();
        const event = createTestEvent({
          aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
          aggregateType: TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
          createdAt: 2000,
          data: {},
          id: "e1",
        });
        const foldDef = missingStoreFold("counted-absent");
        foldDef.eventLoaderUpTo = vi.fn().mockResolvedValue([]);
        const before = await refoldCount("counted-absent", "absent");

        await executor.execute(foldDef, event, context);

        expect(await refoldCount("counted-absent", "absent")).toBe(before + 1);
      });
    });
  });
});
