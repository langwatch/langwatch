import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  tenantDailyBillableEventsProjection,
  tenantDailyBillableEventsStore,
} from "../tenantDailyEventCount.foldProjection";
import type { Event } from "../../../library/domain/types";
import {
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../../library/services/__tests__/testHelpers";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../../pipelines/trace-processing/schemas/constants";
import { EVALUATION_STARTED_EVENT_TYPE } from "../../../pipelines/evaluation-processing/schemas/constants";
import type { ProjectionStoreContext } from "../../../library/projections/projectionStoreContext";

describe("tenantDailyBillableEventsProjection", () => {
  const tenantId = createTestTenantId();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("definition", () => {
    it("subscribes to span_received and evaluation_started events", () => {
      expect(tenantDailyBillableEventsProjection.eventTypes).toEqual([
        SPAN_RECEIVED_EVENT_TYPE,
        EVALUATION_STARTED_EVENT_TYPE,
      ]);
    });
  });

  describe("key function", () => {
    it("produces tenantId:date key", () => {
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        undefined,
        // Jan 12, 1970 (1000000 ms from epoch)
        1000000,
      );

      const key = tenantDailyBillableEventsProjection.key!(event as Event);
      expect(key).toBe(`${tenantId}:1970-01-01`);
    });

    it("groups events from the same day together", () => {
      const dayMs = 1_700_000_000_000; // Nov 14, 2023
      const event1 = createTestEvent(
        "agg-1",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        undefined,
        dayMs,
      );
      const event2 = createTestEvent(
        "agg-2",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        undefined,
        dayMs + 3600_000, // 1 hour later, same day
      );

      const key1 = tenantDailyBillableEventsProjection.key!(event1 as Event);
      const key2 = tenantDailyBillableEventsProjection.key!(event2 as Event);
      expect(key1).toBe(key2);
    });
  });

  describe("apply function", () => {
    it("increments count and sets tenantId/date", () => {
      const state = tenantDailyBillableEventsProjection.init();
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        undefined,
        1_700_000_000_000,
      );

      const newState = tenantDailyBillableEventsProjection.apply(state, event as Event);

      expect(newState.count).toBe(1);
      expect(newState.tenantId).toBe(String(tenantId));
      expect(newState.date).toBe("2023-11-14");
    });

    it("accumulates count across events", () => {
      let state = tenantDailyBillableEventsProjection.init();
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        undefined,
        1_700_000_000_000,
      );

      state = tenantDailyBillableEventsProjection.apply(state, event as Event);
      state = tenantDailyBillableEventsProjection.apply(state, event as Event);
      state = tenantDailyBillableEventsProjection.apply(state, event as Event);

      expect(state.count).toBe(3);
    });
  });

  describe("store", () => {
    it("stores and retrieves state by key", async () => {
      const context: ProjectionStoreContext = {
        aggregateId: "ignored",
        tenantId,
        key: `${tenantId}:2023-11-14`,
      };

      const state = { tenantId: String(tenantId), date: "2023-11-14", count: 42 };
      await tenantDailyBillableEventsStore.store(state, context);

      const retrieved = await tenantDailyBillableEventsStore.get(context.key!, context);
      expect(retrieved).toEqual(state);
    });

    it("returns null for unknown keys", async () => {
      const context: ProjectionStoreContext = {
        aggregateId: "ignored",
        tenantId,
      };

      const result = await tenantDailyBillableEventsStore.get("nonexistent", context);
      expect(result).toBeNull();
    });
  });
});
