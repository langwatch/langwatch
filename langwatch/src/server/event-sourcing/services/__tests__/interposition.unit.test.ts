/**
 * Unit tests for the leanForProjection interposition in EventSourcingService.
 *
 * ADR-022: Between `eventStore.storeEvents()` and `router.dispatch()`, every
 * event is transformed via `leanForProjection(event)`. The dispatch always
 * sees the lean shape; the event store always sees the full content.
 *
 * These tests FAIL at unit runtime because the production interposition is not
 * yet wired (Step 5). They pass typecheck, serving as the TDD contract.
 *
 * BDD structure: describe("given X") → describe("when Y") → it("…").
 * No "should" in it() names (project convention).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Event } from "../../domain/types";
import { EventSourcingService } from "../eventSourcingService";
import {
  createMockEventStore,
  createMockMapProjectionDefinition,
  createTestEvent,
  createTestEventStoreReadContext,
  createTestTenantId,
  createTestAggregateType,
  TEST_CONSTANTS,
} from "./testHelpers";

// ---------------------------------------------------------------------------
// Mock leanForProjection
// ---------------------------------------------------------------------------

vi.mock("~/server/app-layer/traces/lean-for-projection", () => ({
  leanForProjection: vi.fn((event: Event) => ({
    ...event,
    // Marker so tests can verify dispatch received the leaned shape
    data: { ...((event.data as Record<string, unknown>) ?? {}), _leaned: true },
  })),
}));

// Pull the mock handle so we can assert call counts and override behavior
import { leanForProjection } from "~/server/app-layer/traces/lean-for-projection";
const leanMock = vi.mocked(leanForProjection);

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("given EventSourcingService is configured with a map projection", () => {
  const aggregateType = createTestAggregateType();
  const tenantId = createTestTenantId();
  const context = createTestEventStoreReadContext(tenantId);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
    leanMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * @scenario leanForProjection is the single source of truth for the lean shape
   */
  describe("when one SpanReceived event is stored", () => {
    it("storeEvents is called with the original (full) event, and router.dispatch is called with the leaned event", async () => {
      const eventStore = createMockEventStore<Event>();
      const mapDef = createMockMapProjectionDefinition("lean-dispatch");
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        mapProjections: [mapDef],
      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      await service.storeEvents(events, context);

      // storeEvents sees the original event (no _leaned marker)
      const storedArg = (eventStore.storeEvents as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as Event[];
      expect((storedArg[0]?.data as Record<string, unknown>)?.["_leaned"]).toBeUndefined();

      // dispatch sees the leaned event (has _leaned marker)
      const dispatchedArg = (mapDef.map as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Event;
      expect((dispatchedArg.data as Record<string, unknown>)?.["_leaned"]).toBe(true);
    });
  });

  describe("when multiple events are stored in one call", () => {
    it("each event is leaned individually via leanForProjection", async () => {
      const eventStore = createMockEventStore<Event>();
      const mapDef = createMockMapProjectionDefinition("lean-each");

      // mapDef.eventTypes must include the test event type to trigger dispatch
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        mapProjections: [{ ...mapDef, eventTypes: [] }],
      });

      const events = [
        createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
        createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
        createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
      ];

      await service.storeEvents(events, context);

      // leanForProjection must be called once per event
      expect(leanMock).toHaveBeenCalledTimes(events.length);
      expect(leanMock).toHaveBeenCalledWith(events[0]);
      expect(leanMock).toHaveBeenCalledWith(events[1]);
      expect(leanMock).toHaveBeenCalledWith(events[2]);
    });
  });

  describe("when leanForProjection throws an error", () => {
    it("the error propagates out of storeEvents (not swallowed)", async () => {
      leanMock.mockImplementationOnce(() => {
        throw new Error("lean exploded");
      });

      const eventStore = createMockEventStore<Event>();
      const mapDef = createMockMapProjectionDefinition("lean-throw");
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        mapProjections: [mapDef],
      });

      const events = [
        createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
      ];

      await expect(service.storeEvents(events, context)).rejects.toThrow(
        "lean exploded",
      );
    });
  });

  describe("when one event is stored with both storeEvents and dispatch in sequence", () => {
    it("storeEvents resolves before leanForProjection is called, and dispatch occurs after", async () => {
      // The ordering invariant: storeEvents → leanForProjection → dispatch.
      // Verified by tracking call order via a shared call log.
      const callOrder: string[] = [];

      const eventStore = createMockEventStore<Event>();
      (eventStore.storeEvents as ReturnType<typeof vi.fn>).mockImplementation(
        async (..._args: unknown[]) => {
          callOrder.push("storeEvents");
        },
      );

      leanMock.mockImplementation((event: Event) => {
        callOrder.push("leanForProjection");
        return { ...event, data: { ...(event.data as Record<string, unknown>), _leaned: true } };
      });

      const mapDef = createMockMapProjectionDefinition("order-test");
      (mapDef.map as ReturnType<typeof vi.fn>).mockImplementation((event: Event) => {
        callOrder.push("dispatch");
        return event;
      });

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        mapProjections: [{ ...mapDef, eventTypes: [] }],
      });

      const events = [
        createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
      ];

      await service.storeEvents(events, context);

      // storeEvents MUST complete before leanForProjection is called
      const storeIdx = callOrder.indexOf("storeEvents");
      const leanIdx = callOrder.indexOf("leanForProjection");
      const dispatchIdx = callOrder.indexOf("dispatch");

      expect(storeIdx).toBeLessThan(leanIdx);
      expect(leanIdx).toBeLessThan(dispatchIdx);
    });
  });
});
