import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Event } from "../../domain/types.ts";
import {
  createMockFoldProjectionDefinition,
  createMockFoldProjectionStore,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers.ts";
import { FoldStateNotVisibleError } from "../../services/errorHandling.ts";
import type { EventLogProbe } from "../../stores/repositories/eventRepository.types.ts";
import { FoldProjectionExecutor } from "../foldProjectionExecutor.ts";
import type { ProjectionStoreContext } from "../projectionStoreContext.ts";

/**
 * A store miss under `refoldOnStoreMiss` asks the event log whether the aggregate is new before
 * replaying it. New: fold from init. Otherwise the saved state is most likely on a replica that
 * has not caught up, so the job retries shortly, twice by default, before the replay runs.
 */
let meter = createRecordingMeterProvider();

describe("FoldProjectionExecutor store-miss probe", () => {
  const tenantId = createTestTenantId();

  interface CountState {
    ids: string[];
    LastEventOccurredAt: number;
  }

  const init = (): CountState => ({ ids: [], LastEventOccurredAt: 0 });
  const apply = (state: CountState, event: Event): CountState => ({
    ids: [...state.ids, event.id],
    LastEventOccurredAt: Math.max(state.LastEventOccurredAt, event.occurredAt ?? 0),
  });

  function queued(deliveryAttempt: number | undefined): ProjectionStoreContext {
    return {
      aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
      tenantId,
      ...(deliveryAttempt === undefined ? {} : { deliveryAttempt }),
    };
  }

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

  function missingFold(name: string, shown: EventLogProbe, history: Event[] = []) {
    const store = createMockFoldProjectionStore<CountState>();
    const fold = createMockFoldProjectionDefinition(name, {
      store,
      init,
      apply,
      options: { refoldOnStoreMiss: true },
    });
    const eventLoaderUpTo = vi.fn().mockResolvedValue(history);
    const eventLogProbe = vi.fn().mockResolvedValue(shown);
    fold.eventLoaderUpTo = eventLoaderUpTo;
    fold.eventLogProbe = eventLogProbe;
    return { fold, store, eventLoaderUpTo, eventLogProbe };
  }

  function probeCount(projectionName: string, outcome: string): number {
    return meter.valueOf("es_fold_store_miss_probe_total", {
      projection_name: projectionName,
      outcome,
    });
  }

  const NEW: EventLogProbe = { hasEvent: true, hasEarlierEvents: false };
  const HAS_HISTORY: EventLogProbe = { hasEvent: true, hasEarlierEvents: true };
  const LOG_BEHIND: EventLogProbe = { hasEvent: false, hasEarlierEvents: false };

  beforeEach(() => {
    meter = createRecordingMeterProvider();
    meter.install();
  });
  afterEach(() => meter.uninstall());

  describe("given the log shows the delivered event and nothing before it", () => {
    /** @scenario a missed state on a new aggregate folds from empty without replaying the log */
    it("folds the new aggregate from init without replaying the event log", async () => {
      const executor = new FoldProjectionExecutor();
      const e1 = makeEvent("e1", 1000);
      const { fold, store, eventLoaderUpTo, eventLogProbe } = missingFold("probe-new", NEW);

      const result = (await executor.execute(fold, e1, queued(1))) as CountState;

      expect(result.ids).toEqual(["e1"]);
      expect(eventLogProbe).toHaveBeenCalledWith({
        tenantId,
        aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
        event: e1,
        ignoreEventIds: [],
      });
      expect(eventLoaderUpTo).not.toHaveBeenCalled();
      expect(store.store).toHaveBeenCalledWith(
        result,
        expect.objectContaining({ appliedEventIds: ["e1"] }),
      );
      expect(probeCount("probe-new", "new_aggregate")).toBe(1);
    });
  });

  describe("given the log shows earlier events but the store has no state", () => {
    /** @scenario a missed state the event log says exists is waited for before it is replayed */
    it("hands the job back to wait for the state instead of replaying the log", async () => {
      const executor = new FoldProjectionExecutor();
      const e2 = makeEvent("e2", 2000);
      const { fold, store, eventLoaderUpTo } = missingFold("probe-state", HAS_HISTORY);

      const failure = await executor.execute(fold, e2, queued(1)).catch((error) => error);

      expect(failure).toBeInstanceOf(FoldStateNotVisibleError);
      expect((failure as FoldStateNotVisibleError).missing).toBe("state");
      expect(eventLoaderUpTo).not.toHaveBeenCalled();
      expect(store.store).not.toHaveBeenCalled();
      expect(probeCount("probe-state", "retried_state_not_visible")).toBe(1);
    });

    it("still waits on the second delivery", async () => {
      const executor = new FoldProjectionExecutor();
      const { fold } = missingFold("probe-second", HAS_HISTORY);

      const failure = await executor
        .execute(fold, makeEvent("e2", 2000), queued(2))
        .catch((error) => error);

      expect(failure).toBeInstanceOf(FoldStateNotVisibleError);
    });

    /** @scenario a missed state that stays missing is rebuilt after the bounded wait */
    it("re-folds from the event log once the job has waited twice", async () => {
      const executor = new FoldProjectionExecutor();
      const e1 = makeEvent("e1", 1000);
      const e2 = makeEvent("e2", 2000);
      const { fold, eventLoaderUpTo } = missingFold("probe-spent", HAS_HISTORY, [e1, e2]);

      const result = (await executor.execute(fold, e2, queued(3))) as CountState;

      expect(result.ids).toEqual(["e1", "e2"]);
      expect(eventLoaderUpTo).toHaveBeenCalledTimes(1);
      expect(probeCount("probe-spent", "refold_after_retries")).toBe(1);
      expect(
        meter.valueOf("es_fold_refold_on_miss_total", {
          projection_name: "probe-spent",
          outcome: "performed",
        }),
      ).toBe(1);
    });

    it("waits as many deliveries as the executor is configured for", async () => {
      const executor = new FoldProjectionExecutor({ storeMissRetries: 1 });
      const e2 = makeEvent("e2", 2000);
      const { fold, eventLoaderUpTo } = missingFold("probe-configured", HAS_HISTORY, [e2]);

      await executor.execute(fold, e2, queued(2));

      expect(eventLoaderUpTo).toHaveBeenCalledTimes(1);
    });
  });

  describe("given the log does not show the delivered event yet", () => {
    /** @scenario a log that lags behind the delivered event is waited for too */
    it("waits rather than calling the aggregate new", async () => {
      const executor = new FoldProjectionExecutor();
      const { fold, store } = missingFold("probe-log", LOG_BEHIND);

      const failure = await executor
        .execute(fold, makeEvent("e2", 2000), queued(1))
        .catch((error) => error);

      expect((failure as FoldStateNotVisibleError).missing).toBe("log");
      expect(store.store).not.toHaveBeenCalled();
      expect(probeCount("probe-log", "retried_log_not_visible")).toBe(1);
    });
  });

  describe("given a fold the queue cannot retry or that opted out", () => {
    it("re-folds at once outside the queue, where nothing would retry", async () => {
      const executor = new FoldProjectionExecutor();
      const e2 = makeEvent("e2", 2000);
      const { fold, eventLoaderUpTo, eventLogProbe } = missingFold("probe-inline", HAS_HISTORY);
      eventLoaderUpTo.mockResolvedValue([e2]);

      await executor.execute(fold, e2, queued(undefined));

      expect(eventLogProbe).not.toHaveBeenCalled();
      expect(eventLoaderUpTo).toHaveBeenCalledTimes(1);
    });

    it("re-folds at once when the executor allows no waits", async () => {
      const executor = new FoldProjectionExecutor({ storeMissRetries: 0 });
      const e2 = makeEvent("e2", 2000);
      const { fold, eventLoaderUpTo, eventLogProbe } = missingFold("probe-off", HAS_HISTORY, [e2]);

      await executor.execute(fold, e2, queued(1));

      expect(eventLogProbe).not.toHaveBeenCalled();
      expect(eventLoaderUpTo).toHaveBeenCalledTimes(1);
    });

    it("re-folds at once for a keyed fold, which one log cannot prove new", async () => {
      const executor = new FoldProjectionExecutor();
      const e2 = makeEvent("e2", 2000);
      const { fold, eventLogProbe } = missingFold("probe-keyed", NEW, [e2]);

      await executor.execute(fold, e2, { ...queued(1), key: "shared-key" });

      expect(eventLogProbe).not.toHaveBeenCalled();
    });
  });

  describe("given the store found a row it cannot decode", () => {
    /** @scenario an undecodable state is still rebuilt at once */
    it("re-folds at once without probing", async () => {
      const executor = new FoldProjectionExecutor();
      const e1 = makeEvent("e1", 1000);
      const e2 = makeEvent("e2", 2000);
      const { fold, store, eventLoaderUpTo, eventLogProbe } = missingFold(
        "probe-undecodable",
        HAS_HISTORY,
        [e1, e2],
      );
      store.getWithApplied = vi.fn().mockResolvedValue({
        state: null,
        appliedEventIds: [],
        miss: "undecodable",
      });

      const result = (await executor.execute(fold, e2, queued(1))) as CountState;

      expect(result.ids).toEqual(["e1", "e2"]);
      expect(eventLogProbe).not.toHaveBeenCalled();
      expect(eventLoaderUpTo).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a coalesced batch misses its state", () => {
    /** @scenario a coalesced batch takes the same path as a single event */
    it("probes from the batch's latest event and folds a new aggregate from init", async () => {
      const executor = new FoldProjectionExecutor();
      const e1 = makeEvent("e1", 1000);
      const e2 = makeEvent("e2", 2000);
      const { fold, store, eventLoaderUpTo, eventLogProbe } = missingFold("probe-batch-new", NEW);

      const result = (await executor.executeBatch(fold, [e2, e1], queued(1))) as CountState;

      expect(result.ids).toEqual(["e1", "e2"]);
      expect(eventLogProbe).toHaveBeenCalledWith(
        expect.objectContaining({ event: e2, ignoreEventIds: ["e1"] }),
      );
      expect(eventLoaderUpTo).not.toHaveBeenCalled();
      expect(store.store).toHaveBeenCalledWith(
        result,
        expect.objectContaining({ appliedEventIds: ["e1", "e2"] }),
      );
    });

    it("hands the whole batch back when the log shows earlier events", async () => {
      const executor = new FoldProjectionExecutor();
      const { fold, store } = missingFold("probe-batch-state", HAS_HISTORY);

      const batch = [makeEvent("e2", 2000), makeEvent("e3", 3000)];

      const failure = await executor.executeBatch(fold, batch, queued(1)).catch((error) => error);

      expect(failure).toBeInstanceOf(FoldStateNotVisibleError);
      expect(store.store).not.toHaveBeenCalled();
    });

    it("waits when a past job folded an event between the batch's first and last", async () => {
      const executor = new FoldProjectionExecutor();
      const e1 = makeEvent("e1", 1000);
      const e2 = makeEvent("e2", 2000);
      const e3 = makeEvent("e3", 3000);
      const log = [e1, e2, e3];
      const { fold, store } = missingFold("probe-batch-gap", NEW);
      fold.eventLogProbe = vi.fn(async ({ event, ignoreEventIds = [] }) => ({
        hasEvent: log.includes(event),
        hasEarlierEvents: log.some(
          (each) => each.createdAt < event.createdAt && !ignoreEventIds.includes(each.id),
        ),
      }));

      const failure = await executor.executeBatch(fold, [e1, e3], queued(1)).catch((e) => e);

      expect(failure).toBeInstanceOf(FoldStateNotVisibleError);
      expect(store.store).not.toHaveBeenCalled();
    });

    it("re-folds the batch from the event log once the job has waited twice", async () => {
      const executor = new FoldProjectionExecutor();
      const e1 = makeEvent("e1", 1000);
      const e2 = makeEvent("e2", 2000);
      const e3 = makeEvent("e3", 3000);
      const history = [e1, e2, e3];
      const { fold, eventLoaderUpTo } = missingFold("probe-batch-spent", HAS_HISTORY, history);

      const result = (await executor.executeBatch(fold, [e2, e3], queued(3))) as CountState;

      expect(result.ids).toEqual(["e1", "e2", "e3"]);
      expect(eventLoaderUpTo).toHaveBeenCalledTimes(1);
    });
  });
});
