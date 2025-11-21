import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventSourcingService } from "../eventSourcingService";
import type { Event } from "../../domain/types";
import {
  createMockEventStore,
  createMockEventPublisher,
  createMockEventHandlerDefinition,
  createMockEventReactionHandler,
  createMockProjectionDefinition,
  createMockEventHandler,
  createMockProjectionStore,
  createTestEvent,
  createTestTenantId,
  createTestEventStoreReadContext,
  createTestAggregateType,
  TEST_CONSTANTS,
} from "./testHelpers";

describe("EventSourcingService - storeEvents", () => {
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

  describe("successful event storage", () => {
    it("stores events via EventStore with correct parameters", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
      });

      const events = [
        createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
        createTestEvent("aggregate-456", TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
      ];

      await service.storeEvents(events, context);

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
      expect(eventStore.storeEvents).toHaveBeenCalledWith(
        events,
        context,
        aggregateType,
      );
    });

    it("uses correct aggregateType for storage", async () => {
      const eventStore = createMockEventStore<Event>();
      const customAggregateType = "trace_aggregation" as const;
      const service = new EventSourcingService({
        aggregateType: customAggregateType,
        eventStore,
      });

      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      await service.storeEvents(events, context);

      expect(eventStore.storeEvents).toHaveBeenCalledWith(
        events,
        context,
        customAggregateType,
      );
    });

    it("passes context correctly to EventStore", async () => {
      const eventStore = createMockEventStore<Event>();
      const customContext = createTestEventStoreReadContext(tenantId, {
        custom: "metadata",
      });
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
      });

      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      await service.storeEvents(events, customContext);

      expect(eventStore.storeEvents).toHaveBeenCalledWith(
        events,
        customContext,
        aggregateType,
      );
    });
  });

  describe("event publishing", () => {
    it("publishes events after successful storage when configured", async () => {
      const eventStore = createMockEventStore<Event>();
      const eventPublisher = createMockEventPublisher<Event>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventPublisher,
      });

      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      await service.storeEvents(events, context);

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      expect(eventPublisher.publish).toHaveBeenCalledWith(events, context);
    });

    it("does not publish when eventPublisher is not configured", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
      });

      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      await service.storeEvents(events, context);

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
    });

    it("does not publish when events array is empty", async () => {
      const eventStore = createMockEventStore<Event>();
      const eventPublisher = createMockEventPublisher<Event>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventPublisher,
      });

      await service.storeEvents([], context);

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });

    it("logs publishing errors but does not fail storage operation", async () => {
      const eventStore = createMockEventStore<Event>();
      const eventPublisher = createMockEventPublisher<Event>();
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
      eventPublisher.publish = vi.fn().mockRejectedValue(publishError);

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventPublisher,
        logger: logger as any,
      });

      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
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
      const handler = createMockEventReactionHandler<Event>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
      });

      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      await service.storeEvents(events, context);

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
      expect(handler.handle).toHaveBeenCalledTimes(1);
      expect(handler.handle).toHaveBeenCalledWith(events[0]);
    });

    it("dispatches multiple events to handlers", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
      });

      const events = [
        createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
        createTestEvent("aggregate-456", TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
      ];

      await service.storeEvents(events, context);

      expect(handler.handle).toHaveBeenCalledTimes(2);
      expect(handler.handle).toHaveBeenCalledWith(events[0]);
      expect(handler.handle).toHaveBeenCalledWith(events[1]);
    });

    it("does not dispatch when eventHandlers is not configured", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
      });

      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      await service.storeEvents(events, context);

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
    });

    it("does not dispatch when events array is empty", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
      });

      await service.storeEvents([], context);

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
      expect(handler.handle).not.toHaveBeenCalled();
    });

    it("logs handler errors but does not fail storage operation", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
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

      const handlerError = new Error("Handler failed");
      handler.handle = vi.fn().mockRejectedValue(handlerError);

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
        logger: logger as any,
      });

      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
      expect(handler.handle).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          handlerName: "handler",
          eventType: events[0]?.type,
          aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
          tenantId: tenantId,
          error: "Handler failed",
        }),
        "Failed to handle event in handler",
      );
    });
  });

  describe("projection updates", () => {
    it("updates projections after storage when configured", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
      });

      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      // Mock getEvents for projection update
      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      projectionHandler.handle = vi.fn().mockResolvedValue({
        id: "proj-id",
        aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
        tenantId: tenantId,
        version: TEST_CONSTANTS.BASE_TIMESTAMP,
        data: {},
      });

      await service.storeEvents(events, context);

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
      expect(eventStore.getEvents).toHaveBeenCalledWith(
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
        aggregateType,
      );
      expect(projectionHandler.handle).toHaveBeenCalledTimes(1);
      expect(projectionStore.storeProjection).toHaveBeenCalledTimes(1);
    });

    it("groups events by aggregateId and updates each aggregate once", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
      });

      const aggregate1 = "aggregate-1";
      const aggregate2 = "aggregate-2";
      const events = [
        createTestEvent(aggregate1, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
        createTestEvent(aggregate2, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
        createTestEvent(aggregate1, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId), // Same aggregate again
      ];

      // Mock getEvents to return events for each aggregate
      eventStore.getEvents = vi.fn().mockImplementation((aggId) => {
        return Promise.resolve(events.filter((e) => e.aggregateId === aggId));
      });
      projectionHandler.handle = vi.fn().mockResolvedValue({
        id: "proj-id",
        aggregateId: aggregate1,
        tenantId: tenantId,
        version: TEST_CONSTANTS.BASE_TIMESTAMP,
        data: {},
      });

      await service.storeEvents(events, context);

      // Should update projection for aggregate1 twice (once per event)
      // and aggregate2 once
      expect(eventStore.getEvents).toHaveBeenCalledWith(
        aggregate1,
        context,
        aggregateType,
      );
      expect(eventStore.getEvents).toHaveBeenCalledWith(
        aggregate2,
        context,
        aggregateType,
      );
    });

    it("updates all projections for affected aggregates", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler1 = createMockEventHandler<Event, any>();
      const projectionHandler2 = createMockEventHandler<Event, any>();
      const projectionStore1 = createMockProjectionStore<any>();
      const projectionStore2 = createMockProjectionStore<any>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        projections: {
          projection1: createMockProjectionDefinition(
            "projection1",
            projectionHandler1,
            projectionStore1,
          ),
          projection2: createMockProjectionDefinition(
            "projection2",
            projectionHandler2,
            projectionStore2,
          ),
        },
      });

      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      projectionHandler1.handle = vi.fn().mockResolvedValue({
        id: "proj1-id",
        aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
        tenantId: tenantId,
        version: TEST_CONSTANTS.BASE_TIMESTAMP,
        data: {},
      });
      projectionHandler2.handle = vi.fn().mockResolvedValue({
        id: "proj2-id",
        aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
        tenantId: tenantId,
        version: TEST_CONSTANTS.BASE_TIMESTAMP,
        data: {},
      });

      await service.storeEvents(events, context);

      expect(projectionHandler1.handle).toHaveBeenCalledTimes(1);
      expect(projectionHandler2.handle).toHaveBeenCalledTimes(1);
      expect(projectionStore1.storeProjection).toHaveBeenCalledTimes(1);
      expect(projectionStore2.storeProjection).toHaveBeenCalledTimes(1);
    });

    it("does not update projections when projections is not configured", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
      });

      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      await service.storeEvents(events, context);

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
      expect(eventStore.getEvents).not.toHaveBeenCalled();
    });

    it("does not update projections when events array is empty", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
      });

      await service.storeEvents([], context);

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
      expect(eventStore.getEvents).not.toHaveBeenCalled();
      expect(projectionHandler.handle).not.toHaveBeenCalled();
    });

    it("logs projection update errors but does not fail storage operation", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
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

      const projectionError = new Error("Projection update failed");
      eventStore.getEvents = vi.fn().mockRejectedValue(projectionError);

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
        logger: logger as any,
      });

      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          projectionName: "projection",
          aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
          tenantId: tenantId,
          error: "Projection update failed",
        }),
        "Failed to update projection after storing events",
      );
    });
  });

  describe("event storage", () => {
    it("stores events correctly", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
      });

      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      await service.storeEvents(events, context);

      expect(eventStore.storeEvents).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
          }),
        ]),
        context,
        aggregateType,
      );
    });

    it("handles events with same Event ID correctly", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
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
      const eventPublisher = createMockEventPublisher<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();

      const callOrder: string[] = [];

      eventStore.storeEvents = vi.fn().mockImplementation(async () => {
        callOrder.push("store");
        return Promise.resolve();
      });
      eventPublisher.publish = vi.fn().mockImplementation(async () => {
        callOrder.push("publish");
        return Promise.resolve();
      });
      handler.handle = vi.fn().mockImplementation(async () => {
        callOrder.push("handler");
        return Promise.resolve();
      });
      eventStore.getEvents = vi
        .fn()
        .mockResolvedValue([
          createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
        ]);
      projectionHandler.handle = vi.fn().mockImplementation(async () => {
        callOrder.push("projection");
        return {
          id: "proj-id",
          aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
          tenantId: tenantId,
          version: TEST_CONSTANTS.BASE_TIMESTAMP,
          data: {},
        };
      });
      projectionStore.storeProjection = vi.fn().mockImplementation(async () => {
        callOrder.push("storeProjection");
        return Promise.resolve();
      });

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventPublisher,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
      });

      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      await service.storeEvents(events, context);

      // Verify order: store → publish → handler → projection
      expect(callOrder[0]).toBe("store");
      expect(callOrder[1]).toBe("publish");
      expect(callOrder[2]).toBe("handler");
      expect(callOrder[3]).toBe("projection");
      expect(callOrder[4]).toBe("storeProjection");
      expect(callOrder.length).toBeGreaterThanOrEqual(5);
    });

    it("works with all components configured together", async () => {
      const eventStore = createMockEventStore<Event>();
      const eventPublisher = createMockEventPublisher<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();

      eventStore.getEvents = vi
        .fn()
        .mockResolvedValue([
          createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
        ]);
      projectionHandler.handle = vi.fn().mockResolvedValue({
        id: "proj-id",
        aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
        tenantId: tenantId,
        version: TEST_CONSTANTS.BASE_TIMESTAMP,
        data: {},
      });

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventPublisher,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
      });

      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      expect(handler.handle).toHaveBeenCalledTimes(1);
      expect(projectionHandler.handle).toHaveBeenCalledTimes(1);
      expect(projectionStore.storeProjection).toHaveBeenCalledTimes(1);
    });
  });
});
