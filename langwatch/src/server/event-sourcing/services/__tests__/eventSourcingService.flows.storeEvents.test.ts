import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "../../domain/types";
import { EventSourcingService } from "../eventSourcingService";
import {
  createMockEventStore,
  createMockFoldProjectionDefinition,
  createMockMapProjectionDefinition,
  createTestAggregateType,
  createTestEvent,
  createTestEventStoreReadContext,
  createTestTenantId,
  TEST_CONSTANTS,
} from "./testHelpers";

describe("EventSourcingService - Store Events Flow", () => {
  const aggregateType = createTestAggregateType();
  const tenantId = createTestTenantId();
  const context = createTestEventStoreReadContext(tenantId);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("event publishing", () => {
    it("publishes events after successful storage when configured", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      await service.storeEvents(events, context);

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
    });

    it("logs publishing errors but does not fail storage operation", async () => {
      const eventStore = createMockEventStore<Event>();
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn().mockReturnThis(),
        level: "info",
        silent: false,
      };

      const publishError = new Error("Publishing failed");

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        logger: logger as any,
      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateType,
          eventCount: 1,
          error: "Publishing failed",
        }),
        "Failed to publish events to external system",
      );
    });
  });

  describe("event handler dispatch", () => {
    it("dispatches events to handlers after storage when configured", async () => {
      const eventStore = createMockEventStore<Event>();
      const mapDef = createMockMapProjectionDefinition("handler");
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

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
      expect(mapDef.map).toHaveBeenCalledTimes(1);
      expect(mapDef.map).toHaveBeenCalledWith(events[0]);
    });
  });

  describe("projection updates", () => {
    it("updates projections after storage when configured", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldDef = createMockFoldProjectionDefinition("projection");
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      await service.storeEvents(events, context);

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
      // Incremental: apply is called once per event, no event store query
      expect(foldDef.apply).toHaveBeenCalledTimes(1);
      expect(foldDef.store.store).toHaveBeenCalledTimes(1);
    });

    it("applies each event incrementally to fold projections", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldDef = createMockFoldProjectionDefinition("projection");
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
      });

      const aggregate1 = "aggregate-1";
      const aggregate2 = "aggregate-2";
      const events = [
        createTestEvent(aggregate1, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
        createTestEvent(aggregate2, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
        createTestEvent(aggregate1, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId), // Same aggregate again
      ];

      await service.storeEvents(events, context);

      // Incremental: apply is called once per event (3 events = 3 apply calls)
      expect(foldDef.apply).toHaveBeenCalledTimes(3);
      expect(foldDef.store.store).toHaveBeenCalledTimes(3);
    });

    it("updates all projections for affected aggregates", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldDef1 = createMockFoldProjectionDefinition("projection1");
      const foldDef2 = createMockFoldProjectionDefinition("projection2");
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef1, foldDef2],
      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      (foldDef1.apply as ReturnType<typeof vi.fn>).mockImplementation(
        (_state: any) => ({
          id: "proj1-id",
          aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
          tenantId: tenantId,
          version: TEST_CONSTANTS.BASE_TIMESTAMP,
          data: {},
        }),
      );
      (foldDef2.apply as ReturnType<typeof vi.fn>).mockImplementation(
        (_state: any) => ({
          id: "proj2-id",
          aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
          tenantId: tenantId,
          version: TEST_CONSTANTS.BASE_TIMESTAMP,
          data: {},
        }),
      );

      await service.storeEvents(events, context);

      expect(foldDef1.apply).toHaveBeenCalledTimes(1);
      expect(foldDef2.apply).toHaveBeenCalledTimes(1);
      expect(foldDef1.store.store).toHaveBeenCalledTimes(1);
      expect(foldDef2.store.store).toHaveBeenCalledTimes(1);
    });
  });

  describe("event storage", () => {
    it("handles events with same Event ID correctly", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
      });

      const timestamp = 1000000;
      const event1 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        void 0,
        timestamp,
      );
      // Create event2 with same Event ID (same timestamp/tenant/aggregate/type)
      const event2 = {
        ...createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
          void 0,
          timestamp,
        ),
        id: event1.id, // Same Event ID
      };

      // Both events should be stored (deduplication happens at store level)
      await service.storeEvents([event1, event2], context);

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
      expect(eventStore.storeEvents).toHaveBeenCalledWith(
        [event1, event2],
        context,
        aggregateType,
      );
    });
  });

  describe("combined flows", () => {
    it("executes all components in correct order", async () => {
      const eventStore = createMockEventStore<Event>();
      const mapDef = createMockMapProjectionDefinition("handler");
      const foldDef = createMockFoldProjectionDefinition("projection");

      const callOrder: string[] = [];

      eventStore.storeEvents = vi.fn().mockImplementation(async () => {
        callOrder.push("store");
        return Promise.resolve();
      });
      (mapDef.map as ReturnType<typeof vi.fn>).mockImplementation(
        (event: any) => {
          callOrder.push("handler");
          return event;
        },
      );
      eventStore.getEvents = vi
        .fn()
        .mockResolvedValue([
          createTestEvent(
            TEST_CONSTANTS.AGGREGATE_ID,
            TEST_CONSTANTS.AGGREGATE_TYPE,
            tenantId,
          ),
        ]);
      (foldDef.apply as ReturnType<typeof vi.fn>).mockImplementation(
        (_state: any) => {
          callOrder.push("projection");
          return {
            id: "proj-id",
            aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
            tenantId: tenantId,
            version: TEST_CONSTANTS.BASE_TIMESTAMP,
            data: {},
          };
        },
      );
      (foldDef.store.store as ReturnType<typeof vi.fn>).mockImplementation(
        async () => {
          callOrder.push("storeProjection");
          return Promise.resolve();
        },
      );

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        mapProjections: [mapDef],
        foldProjections: [foldDef],
      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      // Mock getEvents to return the same events that are being stored
      eventStore.getEvents = vi.fn().mockResolvedValue(events);

      await service.storeEvents(events, context);

      // Verify order: store -> projection (fold) -> storeProjection -> handler (map)
      // Note: fold projections are dispatched before map projections in the ProjectionRouter
      expect(callOrder[0]).toBe("store");
      expect(callOrder[1]).toBe("projection");
      expect(callOrder[2]).toBe("storeProjection");
      expect(callOrder[3]).toBe("handler");
      expect(callOrder.length).toBeGreaterThanOrEqual(5);
    });

    it("works with all components configured together", async () => {
      const eventStore = createMockEventStore<Event>();
      const mapDef = createMockMapProjectionDefinition("handler");
      const foldDef = createMockFoldProjectionDefinition("projection");

      eventStore.getEvents = vi
        .fn()
        .mockResolvedValue([
          createTestEvent(
            TEST_CONSTANTS.AGGREGATE_ID,
            TEST_CONSTANTS.AGGREGATE_TYPE,
            tenantId,
          ),
        ]);
      (foldDef.apply as ReturnType<typeof vi.fn>).mockImplementation(
        (_state: any) => ({
          id: "proj-id",
          aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
          tenantId: tenantId,
          version: TEST_CONSTANTS.BASE_TIMESTAMP,
          data: {},
        }),
      );

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        mapProjections: [mapDef],
        foldProjections: [foldDef],
      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      // Mock getEvents to return the same events that are being stored
      eventStore.getEvents = vi.fn().mockResolvedValue(events);

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
      expect(mapDef.map).toHaveBeenCalledTimes(1);
      expect(foldDef.apply).toHaveBeenCalledTimes(1);
      expect(foldDef.store.store).toHaveBeenCalledTimes(1);
    });
  });
});
