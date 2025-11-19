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
  createMockDistributedLock,
  createMockEventHandlerCheckpointStore,
  createTestEvent,
  createTestTenantId,
  createTestEventStoreReadContext,
  createTestAggregateType,
  createTestProjection,
  TEST_CONSTANTS,
} from "./testHelpers";

describe("EventSourcingService - Error Handling", () => {
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

  describe("event storage errors", () => {
    it("storage errors propagate (critical path)", async () => {
      const eventStore = createMockEventStore<Event>();
      const storageError = new Error("Storage failed");
      eventStore.storeEvents = vi.fn().mockRejectedValue(storageError);

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
      });

      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, tenantId)];

      await expect(service.storeEvents(events, context)).rejects.toThrow(
        "Storage failed",
      );
    });

    it("downstream operations don't execute if storage fails", async () => {
      const eventStore = createMockEventStore<Event>();
      const eventPublisher = createMockEventPublisher<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();

      const storageError = new Error("Storage failed");
      eventStore.storeEvents = vi.fn().mockRejectedValue(storageError);

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

      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, tenantId)];

      await expect(service.storeEvents(events, context)).rejects.toThrow(
        "Storage failed",
      );

      expect(eventPublisher.publish).not.toHaveBeenCalled();
      expect(handler.handle).not.toHaveBeenCalled();
      expect(projectionHandler.handle).not.toHaveBeenCalled();
    });
  });

  describe("event publishing errors", () => {
    it("publishing errors are caught and logged", async () => {
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

      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, tenantId)];

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateType,
          eventCount: 1,
          error: "Publishing failed",
        }),
        "Failed to publish events to external system",
      );
    });

    it("storage operation succeeds despite publishing failure", async () => {
      const eventStore = createMockEventStore<Event>();
      const eventPublisher = createMockEventPublisher<Event>();

      const publishError = new Error("Publishing failed");
      eventPublisher.publish = vi.fn().mockRejectedValue(publishError);

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventPublisher,
      });

      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, tenantId)];

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
    });

    it("error details are logged correctly", async () => {
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

      const publishError = new Error("Publishing failed with details");
      eventPublisher.publish = vi.fn().mockRejectedValue(publishError);

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventPublisher,
        logger: logger as any,
      });

      const events = [
        createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
        createTestEvent("aggregate-456", tenantId),
      ];

      await service.storeEvents(events, context);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateType,
          eventCount: 2,
          error: "Publishing failed with details",
        }),
        "Failed to publish events to external system",
      );
    });
  });

  describe("handler errors", () => {
    it("individual handler errors are caught and logged", async () => {
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

      const event = createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, tenantId);

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

    it("other handlers continue execution", async () => {
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

      const event = createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, tenantId);

      await expect(
        service.storeEvents([event], context),
      ).resolves.not.toThrow();

      expect(handler1.handle).toHaveBeenCalledTimes(1);
      expect(handler2.handle).toHaveBeenCalledTimes(1);
    });

    it("handler errors don't fail storage", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();

      handler.handle = vi.fn().mockRejectedValue(new Error("Handler failed"));

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
      });

      const event = createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, tenantId);

      await expect(
        service.storeEvents([event], context),
      ).resolves.not.toThrow();

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
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

      const event = createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, tenantId);

      await expect(
        service.storeEvents([event], context),
      ).resolves.not.toThrow();

      expect(handlerA.handle).toHaveBeenCalledTimes(1);
      expect(handlerB.handle).toHaveBeenCalledTimes(1);
    });
  });

  describe("projection update errors", () => {
    it("individual projection errors are caught and logged", async () => {
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

      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, tenantId)];

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();

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

    it("other projections continue updating", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler1 = createMockEventHandler<Event, any>();
      const projectionHandler2 = createMockEventHandler<Event, any>();
      const projectionStore1 = createMockProjectionStore<any>();
      const projectionStore2 = createMockProjectionStore<any>();
      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, tenantId)];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      projectionHandler1.handle = vi
        .fn()
        .mockRejectedValue(new Error("Projection1 failed"));
      projectionHandler2.handle = vi
        .fn()
        .mockResolvedValue(
          createTestProjection(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
        );

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

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();

      expect(projectionHandler1.handle).toHaveBeenCalledTimes(1);
      expect(projectionHandler2.handle).toHaveBeenCalledTimes(1);
      expect(projectionStore2.storeProjection).toHaveBeenCalledTimes(1);
    });

    it("projection errors don't fail storage", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, tenantId)];

      eventStore.getEvents = vi
        .fn()
        .mockRejectedValue(new Error("Projection failed"));

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

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
    });

    it("errors for one aggregate don't affect others", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const aggregate1 = "aggregate-1";
      const aggregate2 = "aggregate-2";
      const events = [
        createTestEvent(aggregate1, tenantId),
        createTestEvent(aggregate2, tenantId),
      ];

      eventStore.getEvents = vi.fn().mockImplementation((aggId) => {
        if (aggId === aggregate1) {
          return Promise.reject(new Error("Aggregate1 failed"));
        }
        return Promise.resolve(events.filter((e) => e.aggregateId === aggId));
      });
      projectionHandler.handle = vi
        .fn()
        .mockResolvedValue(createTestProjection(aggregate2, tenantId));

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

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();

      // Should attempt to update both aggregates
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
      // Should succeed for aggregate2
      expect(projectionHandler.handle).toHaveBeenCalledTimes(1);
    });
  });

  describe("checkpoint errors", () => {
    it("checkpoint save errors are caught and logged", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const checkpointStore = createMockEventHandlerCheckpointStore();
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
        eventHandlerCheckpointStore: checkpointStore,
        logger: logger as any,
      });

      const event = createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, tenantId);

      await expect(
        service.storeEvents([event], context),
      ).resolves.not.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          handlerName: "handler",
          error: "Checkpoint save failed",
        }),
        "Failed to save checkpoint for event handler",
      );
    });

    it("handler execution succeeds despite checkpoint failure", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const checkpointStore = createMockEventHandlerCheckpointStore();

      checkpointStore.saveCheckpoint = vi
        .fn()
        .mockRejectedValue(new Error("Checkpoint failed"));

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
        eventHandlerCheckpointStore: checkpointStore,
      });

      const event = createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, tenantId);

      await expect(
        service.storeEvents([event], context),
      ).resolves.not.toThrow();

      expect(handler.handle).toHaveBeenCalledTimes(1);
    });
  });

  describe("lock errors", () => {
    it("lock acquisition errors are handled gracefully", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const distributedLock = createMockDistributedLock();

      const lockError = new Error("Lock acquisition failed");
      distributedLock.acquire = vi.fn().mockRejectedValue(lockError);

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
        distributedLock,
      });

      await expect(
        service.updateProjectionByName(
          "projection",
          TEST_CONSTANTS.AGGREGATE_ID,
          context,
        ),
      ).rejects.toThrow("Lock acquisition failed");
    });

    it("lock release errors don't fail update", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const distributedLock = createMockDistributedLock();
      const lockHandle = { key: "test-key", value: "test-value" };
      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, tenantId)];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      projectionHandler.handle = vi
        .fn()
        .mockResolvedValue(
          createTestProjection(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
        );
      distributedLock.acquire = vi.fn().mockResolvedValue(lockHandle);
      distributedLock.release = vi
        .fn()
        .mockRejectedValue(new Error("Lock release failed"));

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
        distributedLock,
      });

      // Should not throw even if lock release fails
      await expect(
        service.updateProjectionByName(
          "projection",
          TEST_CONSTANTS.AGGREGATE_ID,
          context,
        ),
      ).resolves.not.toThrow();
    });
  });

  describe("missing dependencies", () => {
    it("service works with minimal configuration", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
      });

      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, tenantId)];

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();
    });

    it("missing optional components don't cause errors", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        // No eventPublisher, eventHandlers, projections, etc.
      });

      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, tenantId)];

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();
      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
    });

    it("required components cause clear error messages", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            createMockEventHandler(),
            createMockProjectionStore(),
          ),
        },
      });

      await expect(
        service.updateProjectionByName(
          "nonexistent",
          TEST_CONSTANTS.AGGREGATE_ID,
          context,
        ),
      ).rejects.toThrow('Projection "nonexistent" not found');
    });
  });
});
