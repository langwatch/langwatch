import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "../../domain/types";
import {
  createMockAppendStore,
  createMockMapProjectionDefinition,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import { MapProjectionExecutor } from "../mapProjectionExecutor";
import type { ProjectionStoreContext } from "../projectionStoreContext";

/**
 * `options.dedupeByIdempotencyKey` — guards additive map sinks (the eval
 * rollup) against duplicate deliveries: the event log is append-only and
 * at-least-once, so a client re-report appends a SECOND event with the same
 * idempotency key, and without this option each append lands another
 * increment.
 */
describe("MapProjectionExecutor dedupeByIdempotencyKey", () => {
  const tenantId = createTestTenantId();
  let executor: MapProjectionExecutor;

  const context: ProjectionStoreContext = {
    aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
    tenantId,
  };

  function makeEvent(id: string, idempotencyKey?: string): Event {
    return {
      ...createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        undefined,
        1000,
        undefined,
        {},
        id,
      ),
      idempotencyKey,
    };
  }

  beforeEach(() => {
    executor = new MapProjectionExecutor();
  });

  describe("given a delivery whose idempotency key is held by an EARLIER event", () => {
    it("skips the increment and appends nothing", async () => {
      const first = makeEvent("e-first", "tenant:eval-1:reported");
      const duplicate = makeEvent("e-dup", "tenant:eval-1:reported");
      const store = createMockAppendStore<{ n: number }>();
      const mapDef = createMockMapProjectionDefinition("rollup", {
        store,
        map: () => ({ n: 1 }),
        options: { dedupeByIdempotencyKey: true },
      });
      // The history loader applies first-occurrence dedup, so only the
      // FIRST holder of the key survives the read.
      mapDef.eventLoaderUpTo = vi.fn().mockResolvedValue([first]);

      const result = await executor.execute(mapDef, duplicate, context);

      expect(result).toBeNull();
      expect(store.append).not.toHaveBeenCalled();
    });
  });

  describe("given the delivery IS the first occurrence of its key", () => {
    it("maps and appends normally", async () => {
      const first = makeEvent("e-first", "tenant:eval-1:reported");
      const store = createMockAppendStore<{ n: number }>();
      const mapDef = createMockMapProjectionDefinition("rollup", {
        store,
        map: () => ({ n: 1 }),
        options: { dedupeByIdempotencyKey: true },
      });
      mapDef.eventLoaderUpTo = vi.fn().mockResolvedValue([first]);

      const result = await executor.execute(mapDef, first, context);

      expect(result).toEqual({ n: 1 });
      expect(store.append).toHaveBeenCalledWith({ n: 1 }, context);
    });
  });

  describe("given the history read cannot see the key holder (event-log read lag)", () => {
    it("fails open and maps the event — over-count beats undercount", async () => {
      const event = makeEvent("e-lagged", "tenant:eval-1:reported");
      const store = createMockAppendStore<{ n: number }>();
      const mapDef = createMockMapProjectionDefinition("rollup", {
        store,
        map: () => ({ n: 1 }),
        options: { dedupeByIdempotencyKey: true },
      });
      mapDef.eventLoaderUpTo = vi.fn().mockResolvedValue([]);

      const result = await executor.execute(mapDef, event, context);

      expect(result).toEqual({ n: 1 });
      expect(store.append).toHaveBeenCalled();
    });
  });

  describe("given the event carries no idempotency key", () => {
    it("maps without consulting the event log", async () => {
      const event = makeEvent("e-plain");
      const store = createMockAppendStore<{ n: number }>();
      const mapDef = createMockMapProjectionDefinition("rollup", {
        store,
        map: () => ({ n: 1 }),
        options: { dedupeByIdempotencyKey: true },
      });
      mapDef.eventLoaderUpTo = vi.fn();

      const result = await executor.execute(mapDef, event, context);

      expect(result).toEqual({ n: 1 });
      expect(mapDef.eventLoaderUpTo).not.toHaveBeenCalled();
    });
  });

  describe("given the option is not set", () => {
    it("never consults the event log even for keyed events", async () => {
      const event = makeEvent("e-keyed", "tenant:eval-1:reported");
      const store = createMockAppendStore<{ n: number }>();
      const mapDef = createMockMapProjectionDefinition("rollup", {
        store,
        map: () => ({ n: 1 }),
      });
      mapDef.eventLoaderUpTo = vi.fn();

      const result = await executor.execute(mapDef, event, context);

      expect(result).toEqual({ n: 1 });
      expect(mapDef.eventLoaderUpTo).not.toHaveBeenCalled();
    });
  });

  describe("given the history read fails", () => {
    it("propagates the error so the queue retries the delivery", async () => {
      const event = makeEvent("e-err", "tenant:eval-1:reported");
      const store = createMockAppendStore<{ n: number }>();
      const mapDef = createMockMapProjectionDefinition("rollup", {
        store,
        map: () => ({ n: 1 }),
        options: { dedupeByIdempotencyKey: true },
      });
      mapDef.eventLoaderUpTo = vi
        .fn()
        .mockRejectedValue(new Error("event_log unavailable"));

      await expect(executor.execute(mapDef, event, context)).rejects.toThrow(
        "event_log unavailable",
      );
      expect(store.append).not.toHaveBeenCalled();
    });
  });
});
