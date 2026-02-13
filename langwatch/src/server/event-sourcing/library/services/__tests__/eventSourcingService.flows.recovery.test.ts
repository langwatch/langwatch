import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventStoreMemory } from "../../../runtime/stores/eventStoreMemory";
import { ProcessorCheckpointStoreMemory } from "../../../runtime/stores/processorCheckpointStoreMemory";
import { CheckpointRepositoryMemory } from "../../../runtime/stores/repositories/checkpointRepositoryMemory";
import { EventRepositoryMemory } from "../../../runtime/stores/repositories/eventRepositoryMemory";
import { EVENT_TYPES } from "../../domain/eventType";
import type { Event } from "../../domain/types";
import { buildCheckpointKey } from "../../utils/checkpointKey";
import { EventSourcingService } from "../eventSourcingService";
import {
  cleanupTestEnvironment,
  createMockEventHandler,
  createMockEventHandlerDefinition,
  createMockEventReactionHandler,
  createMockProjectionDefinition,
  createMockProjectionStore,
  createTestContext,
  createTestEvent,
  createTestProjection,
  setupTestEnvironment,
  TEST_CONSTANTS,
} from "./testHelpers";

describe("EventSourcingService - Recovery Flows", () => {
  const { aggregateType, tenantId, context } = createTestContext();

  beforeEach(() => {
    setupTestEnvironment();
  });

  afterEach(() => {
    cleanupTestEnvironment();
  });

  describe("when handler failures occur (no checkpoints for handlers)", () => {
    it("handler errors are non-critical and do not block subsequent events", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const handler = createMockEventReactionHandler<Event>();
      const checkpointStore = new ProcessorCheckpointStoreMemory(
        new CheckpointRepositoryMemory(),
      );
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
        checkpointStore: checkpointStore,
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

      // Store events
      await eventStore.storeEvents([event1, event2], context, aggregateType);

      // Make handler fail for event1
      handler.handle = vi
        .fn()
        .mockRejectedValueOnce(new Error("Handler failed"))
        .mockResolvedValue(void 0);

      // Process event1 - handler fails but storeEvents does not throw
      // (handler errors are non-critical in sync mode)
      await expect(
        service.storeEvents([event1], context),
      ).resolves.not.toThrow();

      // Process event2 - handlers no longer block on previous failures
      await expect(
        service.storeEvents([event2], context),
      ).resolves.not.toThrow();

      // Both events were dispatched to handler (event1 failed, event2 succeeded)
      expect(handler.handle).toHaveBeenCalledTimes(2);
      expect(handler.handle).toHaveBeenCalledWith(event1);
      expect(handler.handle).toHaveBeenCalledWith(event2);

      // No handler checkpoints are created
      const checkpointKey = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      const checkpoint = await checkpointStore.loadCheckpoint(checkpointKey);
      expect(checkpoint).toBeNull();
    });

    it("handler failures do not create failed checkpoints", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const handler = createMockEventReactionHandler<Event>();
      const checkpointStore = new ProcessorCheckpointStoreMemory(
        new CheckpointRepositoryMemory(),
      );
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
        checkpointStore: checkpointStore,
      });

      const event1 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        TEST_CONSTANTS.BASE_TIMESTAMP,
      );

      // Store event
      await eventStore.storeEvents([event1], context, aggregateType);

      // Make handler fail
      handler.handle = vi.fn().mockRejectedValue(new Error("Handler failed"));

      // Process event - handler fails but storeEvents succeeds
      await expect(
        service.storeEvents([event1], context),
      ).resolves.not.toThrow();

      // No handler checkpoint exists (handlers no longer track checkpoints)
      const checkpointKey = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      const checkpoint = await checkpointStore.loadCheckpoint(checkpointKey);
      expect(checkpoint).toBeNull();
    });

    it("multiple handler failures do not block any events", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const handler = createMockEventReactionHandler<Event>();
      const checkpointStore = new ProcessorCheckpointStoreMemory(
        new CheckpointRepositoryMemory(),
      );
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
        checkpointStore: checkpointStore,
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
      const event3 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        TEST_CONSTANTS.BASE_TIMESTAMP + 2000,
      );

      // Store events
      await eventStore.storeEvents(
        [event1, event2, event3],
        context,
        aggregateType,
      );

      // Make handler fail for event1
      handler.handle = vi
        .fn()
        .mockRejectedValueOnce(new Error("Handler failed"))
        .mockResolvedValue(void 0);

      // Process event1 - handler fails but storeEvents doesn't throw
      await service.storeEvents([event1], context);

      // Process event2 - succeeds (no blocking from failed handler)
      await service.storeEvents([event2], context);
      expect(handler.handle).toHaveBeenCalledTimes(2);

      // Process event3 - also succeeds
      await service.storeEvents([event3], context);
      expect(handler.handle).toHaveBeenCalledTimes(3);
    });

    it("handler can be retried by re-dispatching same event", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const handler = createMockEventReactionHandler<Event>();
      const checkpointStore = new ProcessorCheckpointStoreMemory(
        new CheckpointRepositoryMemory(),
      );
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
        checkpointStore: checkpointStore,
      });

      const event1 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        TEST_CONSTANTS.BASE_TIMESTAMP,
      );

      // Store event
      await eventStore.storeEvents([event1], context, aggregateType);

      // Simulate bug in handler (fails)
      handler.handle = vi.fn().mockRejectedValue(new Error("Bug in handler"));

      // Process event - handler fails
      await expect(
        service.storeEvents([event1], context),
      ).resolves.not.toThrow();

      // Fix handler (bug fixed) - change behavior without resetting to preserve call history
      vi.mocked(handler.handle).mockImplementation(async () => void 0);

      // Reprocess event - handler succeeds this time (no checkpoint clearing needed)
      await service.storeEvents([event1], context);

      // Verify event was processed twice (once failed, once succeeded)
      expect(handler.handle).toHaveBeenCalledTimes(2);
      expect(handler.handle).toHaveBeenLastCalledWith(event1);
    });
  });

  describe("when projection failures occur (checkpoints still used)", () => {
    it("recovery works for projections", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const checkpointStore = new ProcessorCheckpointStoreMemory(
        new CheckpointRepositoryMemory(),
      );
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
        checkpointStore: checkpointStore,
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

      // Make projection handler fail for event1 initially
      projectionHandler.handle = vi
        .fn()
        .mockRejectedValueOnce(new Error("Projection failed"))
        .mockResolvedValue(
          createTestProjection(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
        );

      // Process event1 - should fail (stores and processes)
      await expect(
        service.storeEvents([event1], context),
      ).resolves.not.toThrow();

      // Verify failed checkpoint exists before processing event2
      const checkpointKeyBeforeEvent2 = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "projection",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      const checkpointBeforeEvent2 = await checkpointStore.loadCheckpoint(
        checkpointKeyBeforeEvent2,
      );
      expect(checkpointBeforeEvent2).not.toBeNull();
      expect(checkpointBeforeEvent2?.status).toBe("failed");
      expect(checkpointBeforeEvent2?.sequenceNumber).toBe(1);

      // Process event2 - should be skipped due to previous failure
      // (event2 has sequence 2, but event1 (sequence 1) failed, so processing should be skipped)
      await expect(
        service.storeEvents([event2], context),
      ).resolves.not.toThrow();

      // Verify projection handler was only called once (for event1, which failed)
      expect(projectionHandler.handle).toHaveBeenCalledTimes(1);

      // Step 1: Identify failed events
      const failedEvents = await checkpointStore.getFailedEvents(
        TEST_CONSTANTS.PIPELINE_NAME,
        "projection",
        "projection",
        tenantId,
        aggregateType,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0]?.eventId).toBe(event1.id);

      // Step 2: Clear checkpoint (using new per-aggregate key format)
      const checkpointKey1 = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "projection",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      await checkpointStore.clearCheckpoint(tenantId, checkpointKey1);

      // Step 3: Fix projection handler (now succeeds) - change behavior without resetting
      vi.mocked(projectionHandler.handle).mockImplementation(async () =>
        createTestProjection(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
      );

      // Step 4: Reprocess event1 - should succeed now
      await service.storeEvents([event1], context);

      // Verify projection was updated
      expect(projectionHandler.handle).toHaveBeenCalledTimes(2);

      // Step 5: Reprocess event2 - should succeed now
      await service.storeEvents([event2], context);

      // Verify projection was updated again
      expect(projectionHandler.handle).toHaveBeenCalledTimes(3);
    });

    it("can recover after fixing projection logic", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const checkpointStore = new ProcessorCheckpointStoreMemory(
        new CheckpointRepositoryMemory(),
      );
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
        checkpointStore: checkpointStore,
      });

      const event1 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        TEST_CONSTANTS.BASE_TIMESTAMP,
      );

      // Store event
      await eventStore.storeEvents([event1], context, aggregateType);

      // Simulate bug in projection handler (fails)
      projectionHandler.handle = vi
        .fn()
        .mockRejectedValue(new Error("Bug in projection handler"));

      // Process event - should fail
      await expect(
        service.storeEvents([event1], context),
      ).resolves.not.toThrow();

      // Identify failed event
      const failedEvents = await checkpointStore.getFailedEvents(
        TEST_CONSTANTS.PIPELINE_NAME,
        "projection",
        "projection",
        tenantId,
        aggregateType,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      expect(failedEvents).toHaveLength(1);

      // Clear checkpoint (simulating fix applied, using new per-aggregate key format)
      const checkpointKey1 = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "projection",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      await checkpointStore.clearCheckpoint(tenantId, checkpointKey1);

      // Fix projection handler (bug fixed) - change behavior without resetting
      vi.mocked(projectionHandler.handle).mockImplementation(async () =>
        createTestProjection(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
      );

      // Reprocess event - should succeed
      await service.storeEvents([event1], context);

      // Verify projection was updated successfully
      expect(projectionHandler.handle).toHaveBeenCalledTimes(2); // Once failed, once succeeded
    });
  });

  describe("clearCheckpoint", () => {
    it("removes checkpoint for specific projection aggregate", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const checkpointStore = new ProcessorCheckpointStoreMemory(
        new CheckpointRepositoryMemory(),
      );
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
        checkpointStore: checkpointStore,
      });

      const event1 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        TEST_CONSTANTS.BASE_TIMESTAMP,
      );

      // Store event
      await eventStore.storeEvents([event1], context, aggregateType);

      // Make projection handler fail
      projectionHandler.handle = vi
        .fn()
        .mockRejectedValue(new Error("Projection failed"));

      // Process event - should fail
      await expect(
        service.storeEvents([event1], context),
      ).resolves.not.toThrow();

      // Verify checkpoint exists (using per-aggregate key format)
      const checkpointKey1 = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "projection",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      const checkpointBefore =
        await checkpointStore.loadCheckpoint(checkpointKey1);
      expect(checkpointBefore).not.toBeNull();
      expect(checkpointBefore?.status).toBe("failed");

      // Clear checkpoint
      await checkpointStore.clearCheckpoint(tenantId, checkpointKey1);

      // Verify checkpoint is removed
      const checkpointAfter =
        await checkpointStore.loadCheckpoint(checkpointKey1);
      expect(checkpointAfter).toBeNull();
    });

    it("handles non-existent checkpoints gracefully", async () => {
      const checkpointStore = new ProcessorCheckpointStoreMemory(
        new CheckpointRepositoryMemory(),
      );

      // Try to clear non-existent checkpoint - should not throw
      // Build a proper checkpoint key for a non-existent aggregate
      const nonExistentCheckpointKey = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        "non-existent-id",
      );
      await expect(
        checkpointStore.clearCheckpoint(tenantId, nonExistentCheckpointKey),
      ).resolves.not.toThrow();
    });
  });

  describe("duplicate prevention does not break handler dispatch", () => {
    it("duplicate events are dispatched to handlers even after storage dedup", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const handler = createMockEventReactionHandler<Event>();
      const checkpointStore = new ProcessorCheckpointStoreMemory(
        new CheckpointRepositoryMemory(),
      );
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
        checkpointStore: checkpointStore,
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

      // Make handler fail for event1 initially
      handler.handle = vi
        .fn()
        .mockRejectedValueOnce(new Error("Handler failed"))
        .mockResolvedValue(void 0);

      // Process event1 - handler fails but store succeeds
      await expect(
        service.storeEvents([event1], context),
      ).resolves.not.toThrow();

      // Verify event1 is stored (even though handler failed)
      const eventsBefore = await eventStore.getEvents(
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
        aggregateType,
      );
      expect(eventsBefore).toHaveLength(1);
      expect(eventsBefore[0]?.id).toBe(event1.id);

      // Process event2 - succeeds (handler no longer blocks on previous failures)
      await expect(
        service.storeEvents([event2], context),
      ).resolves.not.toThrow();
      expect(handler.handle).toHaveBeenCalledTimes(2);

      // Verify both events are stored
      const eventsAfter = await eventStore.getEvents(
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
        aggregateType,
      );
      expect(eventsAfter).toHaveLength(2);

      // Fix handler
      vi.mocked(handler.handle).mockImplementation(async () => void 0);

      // Reprocess event1 - no checkpoint clearing needed, just re-dispatch
      await service.storeEvents([event1], context);

      // event1 is only stored once (duplicate prevention)
      const finalEvents = await eventStore.getEvents(
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
        aggregateType,
      );
      const event1Count = finalEvents.filter(
        (e) => e.id === event1.id,
      ).length;
      expect(event1Count).toBe(1);
      expect(finalEvents).toHaveLength(2);

      // Handler was called 3 times total: event1 (failed), event2 (ok), event1 (retry ok)
      expect(handler.handle).toHaveBeenCalledTimes(3);
    });
  });
});
