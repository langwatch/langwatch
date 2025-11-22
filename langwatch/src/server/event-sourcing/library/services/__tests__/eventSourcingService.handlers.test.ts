import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventSourcingService } from "../eventSourcingService";
import type { Event } from "../../domain/types";
import {
  createMockEventStore,
  createMockEventHandlerDefinition,
  createMockEventReactionHandler,
  createMockProcessorCheckpointStore,
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

describe("EventSourcingService - Event Handlers", () => {
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

  describe("handler dispatch", () => {
    it("calls handlers for each event", async () => {
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
        createTestEvent("aggregate-789", TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
      ];

      await service.storeEvents(events, context);

      expect(handler.handle).toHaveBeenCalledTimes(3);
      expect(handler.handle).toHaveBeenCalledWith(events[0]);
      expect(handler.handle).toHaveBeenCalledWith(events[1]);
      expect(handler.handle).toHaveBeenCalledWith(events[2]);
    });

    it("handlers receive correct event", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        TEST_CONSTANTS.BASE_TIMESTAMP,
        { custom: "data" },
      );

      await service.storeEvents([event], context);

      expect(handler.handle).toHaveBeenCalledTimes(1);
      expect(handler.handle).toHaveBeenCalledWith(event);
    });

    it("handlers are called in dependency order", async () => {
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
            dependsOn: ["handlerB"],
          }),
        },
      });

      const event = createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId);
      await service.storeEvents([event], context);

      expect(callOrder).toEqual(["A", "B", "C"]);
    });

    it("handlers with no dependencies run first", async () => {
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
          handlerC: createMockEventHandlerDefinition("handlerC", handlerC, {
            dependsOn: ["handlerA"],
          }),
        },
      });

      const event = createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId);
      await service.storeEvents([event], context);

      // A and B should be before C (order between A and B not specified)
      expect(callOrder[0]).toBeOneOf(["A", "B"]);
      expect(callOrder[1]).toBeOneOf(["A", "B"]);
      expect(callOrder[2]).toBe("C");
    });
  });

  describe("event type filtering", () => {
    it("handlers only receive events matching their eventTypes", async () => {
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

      expect(handler.handle).toHaveBeenCalledTimes(1);
      expect(handler.handle).toHaveBeenCalledWith(event1);
    });

    it("handlers with no eventTypes filter receive all events", async () => {
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

      expect(handler.handle).toHaveBeenCalledTimes(2);
      expect(handler.handle).toHaveBeenCalledWith(event1);
      expect(handler.handle).toHaveBeenCalledWith(event2);
    });

    it("multiple handlers can process same event", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler1 = createMockEventReactionHandler<Event>();
      const handler2 = createMockEventReactionHandler<Event>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {
          handler1: createMockEventHandlerDefinition("handler1", handler1),
          handler2: createMockEventHandlerDefinition("handler2", handler2),
        },
      });

      const event = createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId);

      await service.storeEvents([event], context);

      expect(handler1.handle).toHaveBeenCalledWith(event);
      expect(handler2.handle).toHaveBeenCalledWith(event);
    });
  });

  describe("dependency ordering", () => {
    it("handlers execute after their dependencies", async () => {
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

      expect(callOrder[0]).toBe("A");
      expect(callOrder[1]).toBe("B");
    });

    it("complex dependency chains work correctly", async () => {
      const eventStore = createMockEventStore<Event>();
      const handlerA = createMockEventReactionHandler<Event>();
      const handlerB = createMockEventReactionHandler<Event>();
      const handlerC = createMockEventReactionHandler<Event>();
      const handlerD = createMockEventReactionHandler<Event>();

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
      handlerD.handle = vi.fn().mockImplementation(async () => {
        callOrder.push("D");
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
            dependsOn: ["handlerA"],
          }),
          handlerD: createMockEventHandlerDefinition("handlerD", handlerD, {
            dependsOn: ["handlerB", "handlerC"],
          }),
        },
      });

      const event = createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId);
      await service.storeEvents([event], context);

      // A must be first
      expect(callOrder[0]).toBe("A");
      // B and C must be after A (order between them not specified)
      expect(callOrder[1]).toBeOneOf(["B", "C"]);
      expect(callOrder[2]).toBeOneOf(["B", "C"]);
      // D must be last
      expect(callOrder[3]).toBe("D");
    });

    it("handlers with same dependencies can run in parallel (order not specified)", async () => {
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
            dependsOn: ["handlerA"],
          }),
        },
      });

      const event = createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId);
      await service.storeEvents([event], context);

      // A must be first
      expect(callOrder[0]).toBe("A");
      // B and C order not specified
      expect(callOrder[1]).toBeOneOf(["B", "C"]);
      expect(callOrder[2]).toBeOneOf(["B", "C"]);
    });
  });

  describe("checkpoint management", () => {
    it("saves checkpoints after successful handler execution", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const checkpointStore = createMockProcessorCheckpointStore();
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

      // Checkpoint is saved multiple times: pending, then processed
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledTimes(2);
      // First call: pending status
      expect(checkpointStore.saveCheckpoint).toHaveBeenNthCalledWith(
        1,
        "handler",
        "handler",
        event,
        "pending",
        1,
      );
      // Second call: processed status
      expect(checkpointStore.saveCheckpoint).toHaveBeenNthCalledWith(
        2,
        "handler",
        "handler",
        event,
        "processed",
        1,
      );
    });

    it("checkpoint contains correct information", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const checkpointStore = createMockProcessorCheckpointStore();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
        processorCheckpointStore: checkpointStore,
      });

      const aggregateId = "custom-aggregate-123";
      const timestamp = 2000000;
      const eventType = EVENT_TYPES[0];
      const event = createTestEvent(
        aggregateId,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        eventType,
        timestamp,
      );

      await service.storeEvents([event], context);

      // Checkpoint is saved multiple times: pending, then processed
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledTimes(2);
      // First call: pending status
      expect(checkpointStore.saveCheckpoint).toHaveBeenNthCalledWith(
        1,
        "handler",
        "handler",
        event,
        "pending",
        1,
      );
      // Second call: processed status
      expect(checkpointStore.saveCheckpoint).toHaveBeenNthCalledWith(
        2,
        "handler",
        "handler",
        event,
        "processed",
        1,
      );
    });

    it("checkpoint errors don't fail handler execution", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const checkpointStore = createMockProcessorCheckpointStore();
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

      const checkpointError = new Error("Checkpoint save failed");
      checkpointStore.saveCheckpoint = vi
        .fn()
        .mockRejectedValue(checkpointError);

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
        processorCheckpointStore: checkpointStore,
        logger: logger as any,
      });

      const event = createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId);

      await expect(
        service.storeEvents([event], context),
      ).resolves.not.toThrow();

      expect(handler.handle).toHaveBeenCalledTimes(1);
      // Checkpoint errors are logged but don't prevent handler execution
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          handlerName: "handler",
          error: "Checkpoint save failed",
        }),
        expect.stringMatching(/Failed to save.*checkpoint for event handler/),
      );
    });

    it("checkpoint format is correct", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const checkpointStore = createMockProcessorCheckpointStore();
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

      const mockCalls = (
        checkpointStore.saveCheckpoint as ReturnType<typeof vi.fn>
      ).mock.calls;
      expect(mockCalls[0]).toBeDefined();
      const checkpointCall = mockCalls[0]!;
      // New signature: processorName, processorType, event, status, errorMessage?
      const eventParam = checkpointCall[2] as Event;

      expect(eventParam.id).toMatch(
        new RegExp(
          `^${TEST_CONSTANTS.BASE_TIMESTAMP}:${escapeRegex(String(tenantId))}:${escapeRegex(TEST_CONSTANTS.AGGREGATE_ID)}:${escapeRegex(aggregateType)}$`,
        ),
      );
    });
  });

  describe("error handling", () => {
    it("handler errors are logged", async () => {
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

      const event = createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId);

      await expect(
        service.storeEvents([event], context),
      ).resolves.not.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          handlerName: "handler",
          eventType: event.type,
          aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
          tenantId: tenantId,
          error: "Handler failed",
        }),
        "Failed to handle event in handler",
      );
    });

    it("handler errors don't stop other handlers", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler1 = createMockEventReactionHandler<Event>();
      const handler2 = createMockEventReactionHandler<Event>();

      handler1.handle = vi.fn().mockRejectedValue(new Error("Handler1 failed"));
      handler2.handle = vi.fn().mockResolvedValue(void 0);

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {
          handler1: createMockEventHandlerDefinition("handler1", handler1),
          handler2: createMockEventHandlerDefinition("handler2", handler2),
        },
      });

      const event = createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId);

      await expect(
        service.storeEvents([event], context),
      ).resolves.not.toThrow();

      expect(handler1.handle).toHaveBeenCalledTimes(1);
      expect(handler2.handle).toHaveBeenCalledTimes(1);
    });

    it("dependent handlers still execute even if dependency fails", async () => {
      const eventStore = createMockEventStore<Event>();
      const handlerA = createMockEventReactionHandler<Event>();
      const handlerB = createMockEventReactionHandler<Event>();

      handlerA.handle = vi.fn().mockRejectedValue(new Error("HandlerA failed"));
      handlerB.handle = vi.fn().mockResolvedValue(void 0);

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

      await expect(
        service.storeEvents([event], context),
      ).resolves.not.toThrow();

      expect(handlerA.handle).toHaveBeenCalledTimes(1);
      expect(handlerB.handle).toHaveBeenCalledTimes(1);
    });
  });

  describe("empty/missing configurations", () => {
    it("no handlers configured (nothing happens)", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
      });

      const event = createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId);

      await expect(
        service.storeEvents([event], context),
      ).resolves.not.toThrow();

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
    });

    it("empty events array (nothing happens)", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
      });

      await expect(service.storeEvents([], context)).resolves.not.toThrow();

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
      expect(handler.handle).not.toHaveBeenCalled();
    });
  });

  describe("failure handling and checkpointing", () => {
    it("stops processing when a previous event failed for the same aggregate", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const checkpointStore = createMockProcessorCheckpointStore();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
        processorCheckpointStore: checkpointStore,
      });

      const event1 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        TEST_CONSTANTS.BASE_TIMESTAMP,
      );
      const event2 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        TEST_CONSTANTS.BASE_TIMESTAMP + 1000,
      );

      // Simulate that event1 failed
      checkpointStore.hasFailedEvents = vi
        .fn()
        .mockResolvedValueOnce(false) // First check for event1 (no failures yet)
        .mockResolvedValueOnce(true); // Second check for event2 (event1 failed)

      // Make handler fail for event1
      handler.handle = vi
        .fn()
        .mockRejectedValueOnce(new Error("Handler failed"))
        .mockResolvedValueOnce(void 0);

      // Process event1 - should fail
      await expect(
        service.storeEvents([event1], context),
      ).resolves.not.toThrow();

      // Verify event1 was marked as failed
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledWith(
        "handler",
        "handler",
        event1,
        "failed",
        1,
        "Handler failed",
      );

      // Process event2 - should be skipped due to previous failure
      await expect(
        service.storeEvents([event2], context),
      ).resolves.not.toThrow();

      // Verify event2 handler was not called
      expect(handler.handle).toHaveBeenCalledTimes(1); // Only event1
      expect(checkpointStore.hasFailedEvents).toHaveBeenCalledWith(
        "handler",
        "handler",
        tenantId,
        aggregateType,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
    });

    it("does not stop processing for different aggregates when one fails", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const checkpointStore = createMockProcessorCheckpointStore();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
        processorCheckpointStore: checkpointStore,
      });

      const event1 = createTestEvent(
        "aggregate-1",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        TEST_CONSTANTS.BASE_TIMESTAMP,
      );
      const event2 = createTestEvent(
        "aggregate-2",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        TEST_CONSTANTS.BASE_TIMESTAMP + 1000,
      );

      // Make handler fail for aggregate-1
      handler.handle = vi
        .fn()
        .mockRejectedValueOnce(new Error("Handler failed"))
        .mockResolvedValueOnce(void 0);

      checkpointStore.hasFailedEvents = vi
        .fn()
        .mockResolvedValue(false); // No failures for aggregate-2

      // Process both events
      await expect(
        service.storeEvents([event1, event2], context),
      ).resolves.not.toThrow();

      // Both handlers should be called (even though aggregate-1 failed)
      expect(handler.handle).toHaveBeenCalledTimes(2);
    });

    it("skips processing if event is already processed (idempotency)", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const checkpointStore = createMockProcessorCheckpointStore();
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

      // Simulate event already processed
      checkpointStore.loadCheckpoint = vi.fn().mockResolvedValue({
        processorName: "handler",
        processorType: "handler",
        eventId: event.id,
        status: "processed",
        eventTimestamp: event.timestamp,
        tenantId: event.tenantId,
        aggregateType: event.aggregateType,
        aggregateId: String(event.aggregateId),
      });

      await service.storeEvents([event], context);

      // Handler should not be called
      expect(handler.handle).not.toHaveBeenCalled();
      // Checkpoint should not be saved again
      expect(checkpointStore.saveCheckpoint).not.toHaveBeenCalled();
    });

    it("saves checkpoint with failed status when handler throws", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const checkpointStore = createMockProcessorCheckpointStore();
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

      const error = new Error("Handler processing failed");
      handler.handle = vi.fn().mockRejectedValue(error);
      checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(false);

      await expect(
        service.storeEvents([event], context),
      ).resolves.not.toThrow();

      // Should save pending checkpoint first
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledWith(
        "handler",
        "handler",
        event,
        "pending",
        1,
      );

      // Then save failed checkpoint
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledWith(
        "handler",
        "handler",
        event,
        "failed",
        1,
        "Handler processing failed",
      );
    });

    it("checks for failed events before processing", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const checkpointStore = createMockProcessorCheckpointStore();
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

      // Simulate previous failure
      checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(true);
      checkpointStore.loadCheckpoint = vi.fn().mockResolvedValue(null);

      await expect(
        service.storeEvents([event], context),
      ).resolves.not.toThrow();

      // Should check for failures
      expect(checkpointStore.hasFailedEvents).toHaveBeenCalledWith(
        "handler",
        "handler",
        tenantId,
        aggregateType,
        TEST_CONSTANTS.AGGREGATE_ID,
      );

      // Handler should not be called
      expect(handler.handle).not.toHaveBeenCalled();
    });
  });
});
