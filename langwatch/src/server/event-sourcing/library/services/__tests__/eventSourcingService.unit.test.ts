import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventSourcingService } from "../eventSourcingService";
import type { Event } from "../../domain/types";
import type { EventStream } from "../../streams/eventStream";
import {
  createMockEventStore,
  createMockEventHandlerDefinition,
  createMockEventReactionHandler,
  createMockProjectionDefinition,
  createMockEventHandler,
  createTestEvent,
  createTestTenantId,
  createTestEventStoreReadContext,
  createTestAggregateType,
  TEST_CONSTANTS,
} from "./testHelpers";
import { EVENT_TYPES } from "../../domain/eventType";

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("EventSourcingService - Unit Tests", () => {
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

  describe("topologicalSortHandlers (tested via handler dispatch order)", () => {
    it("sorts handlers with no dependencies first", async () => {
      const eventStore = createMockEventStore<Event>();
      const handlerA = createMockEventReactionHandler<Event>();
      const handlerB = createMockEventReactionHandler<Event>();
      const handlerC = createMockEventReactionHandler<Event>();

      const callOrder: string[] = [];

      handlerA.handle = vi.fn().mockImplementation(async () => {
        callOrder.push("A");
      });
      handlerB.handle = vi.fn().mockImplementation(async () => {
        callOrder.push("B");
      });
      handlerC.handle = vi.fn().mockImplementation(async () => {
        callOrder.push("C");
      });

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {
          handlerA: createMockEventHandlerDefinition("handlerA", handlerA),
          handlerB: createMockEventHandlerDefinition("handlerB", handlerB),
          handlerC: createMockEventHandlerDefinition("handlerC", handlerC),
        },
      });

      const event = createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId);
      await service.storeEvents([event], context);

      // All handlers should be called (order not specified for handlers with no dependencies)
      expect(callOrder.length).toBe(3);
      expect(callOrder).toContain("A");
      expect(callOrder).toContain("B");
      expect(callOrder).toContain("C");
    });

    it("sorts handlers with single dependency correctly", async () => {
      const eventStore = createMockEventStore<Event>();
      const handlerA = createMockEventReactionHandler<Event>();
      const handlerB = createMockEventReactionHandler<Event>();

      const callOrder: string[] = [];

      handlerA.handle = vi.fn().mockImplementation(async () => {
        callOrder.push("A");
      });
      handlerB.handle = vi.fn().mockImplementation(async () => {
        callOrder.push("B");
      });

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {
          handlerA: createMockEventHandlerDefinition("handlerA", handlerA),
          handlerB: createMockEventHandlerDefinition("handlerB", handlerB, {
            dependsOn: ["handlerA"],
          }),
        },
      });

      const event = createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId);
      await service.storeEvents([event], context);

      // Handler A should be called before Handler B
      expect(callOrder.length).toBe(2);
      expect(callOrder[0]).toBe("A");
      expect(callOrder[1]).toBe("B");
    });

    it("sorts handlers with multiple dependencies correctly", async () => {
      const eventStore = createMockEventStore<Event>();
      const handlerA = createMockEventReactionHandler<Event>();
      const handlerB = createMockEventReactionHandler<Event>();
      const handlerC = createMockEventReactionHandler<Event>();

      const callOrder: string[] = [];

      handlerA.handle = vi.fn().mockImplementation(async () => {
        callOrder.push("A");
      });
      handlerB.handle = vi.fn().mockImplementation(async () => {
        callOrder.push("B");
      });
      handlerC.handle = vi.fn().mockImplementation(async () => {
        callOrder.push("C");
      });

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {
          handlerA: createMockEventHandlerDefinition("handlerA", handlerA),
          handlerB: createMockEventHandlerDefinition("handlerB", handlerB, {
            dependsOn: ["handlerA"],
          }),
          handlerC: createMockEventHandlerDefinition("handlerC", handlerC, {
            dependsOn: ["handlerA", "handlerB"],
          }),
        },
      });

      const event = createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId);
      await service.storeEvents([event], context);

      // A should be first, B should be after A, C should be after both
      expect(callOrder.length).toBe(3);
      expect(callOrder[0]).toBe("A");
      expect(callOrder[1]).toBe("B");
      expect(callOrder[2]).toBe("C");
    });

    it("detects circular dependencies", async () => {
      const eventStore = createMockEventStore<Event>();
      const handlerA = createMockEventReactionHandler<Event>();
      const handlerB = createMockEventReactionHandler<Event>();

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {
          handlerA: createMockEventHandlerDefinition("handlerA", handlerA, {
            dependsOn: ["handlerB"],
          }),
          handlerB: createMockEventHandlerDefinition("handlerB", handlerB, {
            dependsOn: ["handlerA"],
          }),
        },
      });

      const event = createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId);

      await expect(service.storeEvents([event], context)).rejects.toThrow(
        "Circular dependency detected",
      );
    });

    it("detects missing dependencies", async () => {
      const eventStore = createMockEventStore<Event>();
      const handlerA = createMockEventReactionHandler<Event>();

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {
          handlerA: createMockEventHandlerDefinition("handlerA", handlerA, {
            dependsOn: ["nonexistent"],
          }),
        },
      });

      const event = createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId);

      await expect(service.storeEvents([event], context)).rejects.toThrow(
        'Handler "handlerA" depends on "nonexistent" which does not exist',
      );
    });

    it("handles empty handler map", async () => {
      const eventStore = createMockEventStore<Event>();

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {},
      });

      const event = createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId);
      await expect(
        service.storeEvents([event], context),
      ).resolves.not.toThrow();
    });
  });

  describe("getHandlerEventTypes (tested via event filtering)", () => {
    it("filters events by explicit options.eventTypes", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler, {
            eventTypes: [EVENT_TYPES[0]],
          }),
        },
      });

      const event1 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
      );
      const event2 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[1] ?? EVENT_TYPES[0],
      );

      await service.storeEvents([event1, event2], context);

      // Handler should only receive event1 (matching eventTypes)
      expect(handler.handle).toHaveBeenCalledTimes(1);
      expect(handler.handle).toHaveBeenCalledWith(event1);
    });

    it("falls back to handler.getEventTypes() when options.eventTypes not specified", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
      handler.getEventTypes = vi.fn().mockReturnValue([EVENT_TYPES[0]]);

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
      });

      const event1 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
      );
      const event2 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[1] ?? EVENT_TYPES[0],
      );

      await service.storeEvents([event1, event2], context);

      // Handler should only receive event1 (matching getEventTypes())
      expect(handler.handle).toHaveBeenCalledTimes(1);
      expect(handler.handle).toHaveBeenCalledWith(event1);
    });

    it("processes all events when neither options.eventTypes nor getEventTypes() specified", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
      });

      const event1 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
      );
      const event2 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[1] ?? EVENT_TYPES[0],
      );

      await service.storeEvents([event1, event2], context);

      // Handler should receive all events
      expect(handler.handle).toHaveBeenCalledTimes(2);
      expect(handler.handle).toHaveBeenCalledWith(event1);
      expect(handler.handle).toHaveBeenCalledWith(event2);
    });
  });

  describe("createEventId (tested via checkpoint format)", () => {
    it("creates event ID in correct format", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const checkpointStore = {
        saveCheckpoint: vi.fn().mockResolvedValue(void 0),
        loadCheckpoint: vi.fn().mockResolvedValue(null),
        getLastProcessedEvent: vi.fn().mockResolvedValue(null),
        hasFailedEvents: vi.fn().mockResolvedValue(false),
        getFailedEvents: vi.fn().mockResolvedValue([]),
        clearCheckpoint: vi.fn().mockResolvedValue(void 0),
      };

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
        processorCheckpointStore: checkpointStore,
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        TEST_CONSTANTS.BASE_TIMESTAMP,
      );

      await service.storeEvents([event], context);

      // Checkpoint is saved with new signature: processorName, processorType, event, status
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledWith(
        "handler",
        "handler",
        expect.objectContaining({
          id: expect.stringMatching(
            new RegExp(
              `^${TEST_CONSTANTS.BASE_TIMESTAMP}:${escapeRegex(String(tenantId))}:${escapeRegex(TEST_CONSTANTS.AGGREGATE_ID)}:${escapeRegex(aggregateType)}$`,
            ),
          ),
          tenantId: tenantId,
          aggregateType: aggregateType,
          aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
        }),
        expect.any(String), // status: "pending" or "processed"
      );
    });

    it("handles different aggregateId types", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const checkpointStore = {
        saveCheckpoint: vi.fn().mockResolvedValue(void 0),
        loadCheckpoint: vi.fn().mockResolvedValue(null),
        getLastProcessedEvent: vi.fn().mockResolvedValue(null),
        hasFailedEvents: vi.fn().mockResolvedValue(false),
        getFailedEvents: vi.fn().mockResolvedValue([]),
        clearCheckpoint: vi.fn().mockResolvedValue(void 0),
      };

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
        processorCheckpointStore: checkpointStore,
      });

      const numericAggregateId = "12345";
      const event = createTestEvent(
        numericAggregateId,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        TEST_CONSTANTS.BASE_TIMESTAMP,
      );

      await service.storeEvents([event], context);

      // Checkpoint is saved with new signature: processorName, processorType, event, status
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledWith(
        "handler",
        "handler",
        expect.objectContaining({
          id: expect.stringMatching(
            new RegExp(
              `^${TEST_CONSTANTS.BASE_TIMESTAMP}:${escapeRegex(String(tenantId))}:${escapeRegex(numericAggregateId)}:${escapeRegex(aggregateType)}$`,
            ),
          ),
          tenantId: tenantId,
          aggregateType: aggregateType,
          aggregateId: numericAggregateId,
        }),
        expect.any(String), // status: "pending" or "processed"
      );
    });
  });

  describe("createEventStream (tested via projection updates)", () => {
    it("applies timestamp ordering strategy correctly", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = {
        getProjection: vi.fn().mockResolvedValue(null),
        storeProjection: vi.fn().mockResolvedValue(void 0),
      };

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
          EVENT_TYPES[0],
          1000002,
        ),
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
          EVENT_TYPES[0],
          1000000,
        ),
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
          EVENT_TYPES[0],
          1000001,
        ),
      ];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);

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
        serviceOptions: {
          ordering: "timestamp",
        },
      });

      await service.updateProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      // Verify handler was called with a stream
      expect(projectionHandler.handle).toHaveBeenCalledTimes(1);
      const mockCalls = (projectionHandler.handle as ReturnType<typeof vi.fn>)
        .mock.calls;
      expect(mockCalls[0]).toBeDefined();
      const stream = mockCalls[0]![0] as EventStream<any, Event>;

      // Verify events are ordered by timestamp
      const streamEvents = stream.getEvents();
      expect(streamEvents[0]?.timestamp).toBe(1000000);
      expect(streamEvents[1]?.timestamp).toBe(1000001);
      expect(streamEvents[2]?.timestamp).toBe(1000002);
    });

    it("preserves event order when using 'as-is' ordering", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = {
        getProjection: vi.fn().mockResolvedValue(null),
        storeProjection: vi.fn().mockResolvedValue(void 0),
      };

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
          EVENT_TYPES[0],
          1000002,
        ),
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
          EVENT_TYPES[0],
          1000000,
        ),
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
          EVENT_TYPES[0],
          1000001,
        ),
      ];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);

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
        serviceOptions: {
          ordering: "as-is",
        },
      });

      await service.updateProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      // Verify handler was called with a stream
      expect(projectionHandler.handle).toHaveBeenCalledTimes(1);
      const mockCalls = (projectionHandler.handle as ReturnType<typeof vi.fn>)
        .mock.calls;
      expect(mockCalls[0]).toBeDefined();
      const stream = mockCalls[0]![0] as EventStream<any, Event>;

      // Verify events are in original order
      const streamEvents = stream.getEvents();
      expect(streamEvents[0]?.timestamp).toBe(1000002);
      expect(streamEvents[1]?.timestamp).toBe(1000000);
      expect(streamEvents[2]?.timestamp).toBe(1000001);
    });

    it("handles empty events array", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = {
        getProjection: vi.fn().mockResolvedValue(null),
        storeProjection: vi.fn().mockResolvedValue(void 0),
      };

      eventStore.getEvents = vi.fn().mockResolvedValue([]);

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

      await expect(
        service.updateProjectionByName(
          "projection",
          TEST_CONSTANTS.AGGREGATE_ID,
          context,
        ),
      ).rejects.toThrow("No events found");
    });
  });
});
