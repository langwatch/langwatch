import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "../../../domain/types";
import { EVALUATION_STARTED_EVENT_TYPE } from "../../../pipelines/evaluation-processing/schemas/constants";
import { EXPERIMENT_RUN_EVENT_TYPES } from "../../../pipelines/experiment-run-processing/schemas/constants";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../../pipelines/trace-processing/schemas/constants";
import {
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../../services/__tests__/testHelpers";
import { projectDailyBillableEventsProjection } from "../projectDailyBillableEvents.foldProjection";

describe("projectDailyBillableEventsProjection", () => {
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
    it("subscribes to all three billable event types", () => {
      expect(projectDailyBillableEventsProjection.eventTypes).toEqual([
        SPAN_RECEIVED_EVENT_TYPE,
        EVALUATION_STARTED_EVENT_TYPE,
        EXPERIMENT_RUN_EVENT_TYPES.STARTED,
      ]);
    });
  });

  describe("key function", () => {
    it("generates key from tenantId and UTC date for span events", () => {
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        SPAN_RECEIVED_EVENT_TYPE,
        1_700_000_000_000,
      );

      const key = projectDailyBillableEventsProjection.key!(event as Event);
      expect(key).toBe(`test-tenant:2023-11-14`);
    });

    it("generates key from tenantId and UTC date for evaluation events", () => {
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVALUATION_STARTED_EVENT_TYPE,
        1_700_000_000_000,
      );

      const key = projectDailyBillableEventsProjection.key!(event as Event);
      expect(key).toBe(`test-tenant:2023-11-14`);
    });

    it("generates key from tenantId and UTC date for experiment run events", () => {
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EXPERIMENT_RUN_EVENT_TYPES.STARTED,
        1_700_000_000_000,
      );

      const key = projectDailyBillableEventsProjection.key!(event as Event);
      expect(key).toBe(`test-tenant:2023-11-14`);
    });

    it("separates events from different tenants on the same day", () => {
      const dayMs = 1_700_000_000_000;
      const otherTenantId = createTestTenantId("other-tenant");

      const event1 = createTestEvent(
        "agg-1",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        SPAN_RECEIVED_EVENT_TYPE,
        dayMs,
      );
      const event2 = createTestEvent(
        "agg-2",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        otherTenantId,
        SPAN_RECEIVED_EVENT_TYPE,
        dayMs,
      );

      const key1 = projectDailyBillableEventsProjection.key!(event1 as Event);
      const key2 = projectDailyBillableEventsProjection.key!(event2 as Event);
      expect(key1).not.toBe(key2);
    });

    it("groups events from the same project and day together", () => {
      const dayMs = 1_700_000_000_000;

      const spanEvent = createTestEvent(
        "agg-1",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        SPAN_RECEIVED_EVENT_TYPE,
        dayMs,
      );
      const evalEvent = createTestEvent(
        "agg-2",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVALUATION_STARTED_EVENT_TYPE,
        dayMs + 1000,
      );
      const expEvent = createTestEvent(
        "agg-3",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EXPERIMENT_RUN_EVENT_TYPES.STARTED,
        dayMs + 2000,
      );

      const key1 = projectDailyBillableEventsProjection.key!(spanEvent as Event);
      const key2 = projectDailyBillableEventsProjection.key!(evalEvent as Event);
      const key3 = projectDailyBillableEventsProjection.key!(expEvent as Event);
      expect(key1).toBe(key2);
      expect(key2).toBe(key3);
    });

    it("separates events from different days", () => {
      const day1Ms = 1_700_000_000_000;
      const day2Ms = day1Ms + 86_400_000;

      const event1 = createTestEvent(
        "agg-1",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        SPAN_RECEIVED_EVENT_TYPE,
        day1Ms,
      );
      const event2 = createTestEvent(
        "agg-2",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        SPAN_RECEIVED_EVENT_TYPE,
        day2Ms,
      );

      const key1 = projectDailyBillableEventsProjection.key!(event1 as Event);
      const key2 = projectDailyBillableEventsProjection.key!(event2 as Event);
      expect(key1).not.toBe(key2);
    });
  });

  describe("init function", () => {
    it("returns zero-value state", () => {
      const state = projectDailyBillableEventsProjection.init();
      expect(state).toEqual({
        projectId: "",
        date: "",
        count: 0,
        lastEventTimestamp: null,
      });
    });
  });

  describe("apply function", () => {
    it("sets projectId, date, and timestamp from span event", () => {
      const state = projectDailyBillableEventsProjection.init();
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        SPAN_RECEIVED_EVENT_TYPE,
        1_700_000_000_000,
      );

      const newState = projectDailyBillableEventsProjection.apply(
        state,
        event as Event,
      );

      expect(newState.projectId).toBe(String(tenantId));
      expect(newState.date).toBe("2023-11-14");
      expect(newState.count).toBe(1);
      expect(newState.lastEventTimestamp).toBe(1_700_000_000_000);
    });

    it("sets projectId, date, and timestamp from evaluation event", () => {
      const state = projectDailyBillableEventsProjection.init();
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVALUATION_STARTED_EVENT_TYPE,
        1_700_000_000_000,
      );

      const newState = projectDailyBillableEventsProjection.apply(
        state,
        event as Event,
      );

      expect(newState.projectId).toBe(String(tenantId));
      expect(newState.date).toBe("2023-11-14");
      expect(newState.count).toBe(1);
      expect(newState.lastEventTimestamp).toBe(1_700_000_000_000);
    });

    it("sets projectId, date, and timestamp from experiment run event", () => {
      const state = projectDailyBillableEventsProjection.init();
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EXPERIMENT_RUN_EVENT_TYPES.STARTED,
        1_700_000_000_000,
      );

      const newState = projectDailyBillableEventsProjection.apply(
        state,
        event as Event,
      );

      expect(newState.projectId).toBe(String(tenantId));
      expect(newState.date).toBe("2023-11-14");
      expect(newState.count).toBe(1);
      expect(newState.lastEventTimestamp).toBe(1_700_000_000_000);
    });

    it("increments count on successive applies", () => {
      const state = projectDailyBillableEventsProjection.init();
      const event1 = createTestEvent(
        "agg-1",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        SPAN_RECEIVED_EVENT_TYPE,
        1_700_000_000_000,
      );
      const event2 = createTestEvent(
        "agg-2",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVALUATION_STARTED_EVENT_TYPE,
        1_700_000_001_000,
      );

      const state1 = projectDailyBillableEventsProjection.apply(
        state,
        event1 as Event,
      );
      const state2 = projectDailyBillableEventsProjection.apply(
        state1,
        event2 as Event,
      );

      expect(state2.count).toBe(2);
      expect(state2.lastEventTimestamp).toBe(1_700_000_001_000);
    });
  });
});
