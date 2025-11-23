import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventSourcingService } from "../eventSourcingService";
import type { Event } from "../../domain/types";
import {
  createMockEventHandlerDefinition,
  createMockEventReactionHandler,
  createMockProjectionDefinition,
  createMockEventHandler,
  createMockProjectionStore,
  createTestEvent,
  createTestProjection,
  TEST_CONSTANTS,
  setupTestEnvironment,
  cleanupTestEnvironment,
  createTestContext,
} from "./testHelpers";
import { EVENT_TYPES } from "../../domain/eventType";
import { EventStoreMemory } from "../../../runtime/stores/eventStoreMemory";
import { EventRepositoryMemory } from "../../../runtime/stores/repositories/eventRepositoryMemory";
import { ProcessorCheckpointStoreMemory } from "../../../runtime/stores/processorCheckpointStoreMemory";
import { CheckpointRepositoryMemory } from "../../../runtime/stores/repositories/checkpointRepositoryMemory";
import { buildCheckpointKey } from "../../utils/checkpointKey";

describe("EventSourcingService - Recovery Flows", () => {
  const { aggregateType, tenantId, context } = createTestContext();

  beforeEach(() => {
    setupTestEnvironment();
  });

  afterEach(() => {
    cleanupTestEnvironment();
  });

  describe("getFailedEvents", () => {
    it("returns failed events for an aggregate via checkpoint store", async () => {
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

      // Store events
      await eventStore.storeEvents([event1, event2], context, aggregateType);

      // Make handler fail for event1
      handler.handle = vi
        .fn()
        .mockRejectedValueOnce(new Error("Handler failed"))
        .mockResolvedValueOnce(void 0);

      // Process event1 - should fail
      await expect(
        service.storeEvents([event1], context),
      ).resolves.not.toThrow();

      // Process event2 - should be skipped due to previous failure
      await expect(
        service.storeEvents([event2], context),
      ).resolves.not.toThrow();

      // Get failed events via checkpoint store
      const failedEvents = await checkpointStore.getFailedEvents(
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        "handler",
        tenantId,
        aggregateType,
        TEST_CONSTANTS.AGGREGATE_ID,
      );

      // Verify failed events are returned
      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0]?.eventId).toBe(event1.id);
      expect(failedEvents[0]?.status).toBe("failed");
      expect(failedEvents[0]?.errorMessage).toBe("Handler failed");
    });

    it("filters by processor name and type correctly", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const handler1 = createMockEventReactionHandler<Event>();
      const handler2 = createMockEventReactionHandler<Event>();
      const checkpointStore = new ProcessorCheckpointStoreMemory(
        new CheckpointRepositoryMemory(),
      );
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        eventHandlers: {
          handler1: createMockEventHandlerDefinition("handler1", handler1),
          handler2: createMockEventHandlerDefinition("handler2", handler2),
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

      // Store event
      await eventStore.storeEvents([event1], context, aggregateType);

      // Make handler1 fail, handler2 succeed
      handler1.handle = vi.fn().mockRejectedValue(new Error("Handler1 failed"));
      handler2.handle = vi.fn().mockResolvedValue(void 0);

      // Process event - handler1 fails, handler2 succeeds
      await expect(
        service.storeEvents([event1], context),
      ).resolves.not.toThrow();

      // Get failed events for handler1
      const failedEvents1 = await checkpointStore.getFailedEvents(
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler1",
        "handler",
        tenantId,
        aggregateType,
        TEST_CONSTANTS.AGGREGATE_ID,
      );

      // Get failed events for handler2
      const failedEvents2 = await checkpointStore.getFailedEvents(
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler2",
        "handler",
        tenantId,
        aggregateType,
        TEST_CONSTANTS.AGGREGATE_ID,
      );

      // Verify only handler1 has failed events
      expect(failedEvents1).toHaveLength(1);
      expect(failedEvents1[0]?.eventId).toBe(event1.id);
      expect(failedEvents2).toHaveLength(0);
    });

    it("returns empty array when no failures", async () => {
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
        processorCheckpointStore: checkpointStore,
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

      // Process event successfully
      await service.storeEvents([event1], context);

      // Get failed events - should be empty
      const failedEvents = await checkpointStore.getFailedEvents(
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        "handler",
        tenantId,
        aggregateType,
        TEST_CONSTANTS.AGGREGATE_ID,
      );

      expect(failedEvents).toHaveLength(0);
    });
  });

  describe("clearCheckpoint", () => {
    it("removes checkpoint for specific event", async () => {
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
        processorCheckpointStore: checkpointStore,
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

      // Process event - should fail
      await expect(
        service.storeEvents([event1], context),
      ).resolves.not.toThrow();

      // Verify checkpoint exists (using new per-aggregate key format)
      const checkpointKey1 = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
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

  describe("end-to-end recovery workflow", () => {
    it("can identify failed events, clear checkpoints, and reprocess", async () => {
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

      // Make handler fail for event1 initially
      handler.handle = vi
        .fn()
        .mockRejectedValueOnce(new Error("Handler failed"))
        .mockResolvedValue(void 0);

      // Process event1 - should fail (stores and processes)
      await expect(
        service.storeEvents([event1], context),
      ).resolves.not.toThrow();

      // Process event2 - should be skipped due to previous failure
      // (event2 has sequence 2, but event1 (sequence 1) failed, so processing should be skipped)
      await expect(
        service.storeEvents([event2], context),
      ).resolves.not.toThrow();

      // Verify event2 handler was not called
      expect(handler.handle).toHaveBeenCalledTimes(1);

      // Step 1: Identify failed events
      const failedEvents = await checkpointStore.getFailedEvents(
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        "handler",
        tenantId,
        aggregateType,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0]?.eventId).toBe(event1.id);

      // Step 2: Clear checkpoint for failed event (using new per-aggregate key format)
      const checkpointKey1 = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      await checkpointStore.clearCheckpoint(tenantId, checkpointKey1);

      // Verify checkpoint is cleared
      const checkpointAfter =
        await checkpointStore.loadCheckpoint(checkpointKey1);
      expect(checkpointAfter).toBeNull();

      // Step 3: Fix handler (now succeeds)
      // Change behavior without resetting to preserve call history
      vi.mocked(handler.handle).mockImplementation(async () => void 0);

      // Step 4: Reprocess event1 - retrieve from store and reprocess
      // Since event1 is already stored, retrieve it from the store
      const storedEvents = await eventStore.getEvents(
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
        aggregateType,
      );
      const event1FromStore = storedEvents.find((e) => e.id === event1.id);
      expect(event1FromStore).toBeDefined();

      // Reprocess by calling storeEvents again (should process since checkpoint is cleared)
      // Note: Duplicate prevention ensures event is not stored twice, but handler is still called for reprocessing
      await service.storeEvents([event1FromStore!], context);

      // Verify event is not stored twice (duplicate prevention)
      const allEventsAfter = await eventStore.getEvents(
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
        aggregateType,
      );
      const event1Count = allEventsAfter.filter(
        (e) => e.id === event1.id,
      ).length;
      expect(event1Count).toBe(1);

      // Verify event1 was processed (handler called twice: once failed, once succeeded)
      expect(handler.handle).toHaveBeenCalledTimes(2);
      // Check that the last call was with event1FromStore (the retrieved event)
      const lastCall = vi.mocked(handler.handle).mock.calls[
        vi.mocked(handler.handle).mock.calls.length - 1
      ];
      expect(lastCall?.[0]?.id).toBe(event1.id);

      // Step 5: Reprocess event2 - should succeed now that event1 is processed
      await service.storeEvents([event2], context);

      // Verify event2 was processed
      expect(handler.handle).toHaveBeenCalledTimes(3);
      expect(handler.handle).toHaveBeenLastCalledWith(event2);
    });

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

    it("failed events stop processing, cleared events resume processing", async () => {
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

      // Process event1 - should fail
      await expect(
        service.storeEvents([event1], context),
      ).resolves.not.toThrow();

      // Try to process event2 - should be skipped (event1 failed)
      await expect(
        service.storeEvents([event2], context),
      ).resolves.not.toThrow();
      expect(handler.handle).toHaveBeenCalledTimes(1); // Only event1

      // Try to process event3 - should be skipped (event1 failed)
      await expect(
        service.storeEvents([event3], context),
      ).resolves.not.toThrow();
      expect(handler.handle).toHaveBeenCalledTimes(1); // Still only event1

      // Clear checkpoint for event1 (using new per-aggregate key format)
      const checkpointKey1 = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      await checkpointStore.clearCheckpoint(tenantId, checkpointKey1);

      // Fix handler - change behavior without resetting to preserve call history
      vi.mocked(handler.handle).mockImplementation(async () => void 0);

      // Reprocess event1 - should succeed
      await service.storeEvents([event1], context);
      expect(handler.handle).toHaveBeenCalledTimes(2); // event1 reprocessed

      // Now event2 should process
      await service.storeEvents([event2], context);
      expect(handler.handle).toHaveBeenCalledTimes(3); // event2 processed

      // Now event3 should process
      await service.storeEvents([event3], context);
      expect(handler.handle).toHaveBeenCalledTimes(4); // event3 processed
    });

    it("duplicate prevention does not break recovery workflow", async () => {
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

      // Make handler fail for event1 initially
      handler.handle = vi
        .fn()
        .mockRejectedValueOnce(new Error("Handler failed"))
        .mockResolvedValue(void 0);

      // Process event1 - should fail
      await expect(
        service.storeEvents([event1], context),
      ).resolves.not.toThrow();

      // Verify event1 is stored (even though processing failed)
      const eventsBefore = await eventStore.getEvents(
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
        aggregateType,
      );
      expect(eventsBefore).toHaveLength(1);
      expect(eventsBefore[0]?.id).toBe(event1.id);

      // Process event2 - should be skipped due to event1 failure
      // Note: event2 is still stored in the event store, just not processed
      await expect(
        service.storeEvents([event2], context),
      ).resolves.not.toThrow();
      expect(handler.handle).toHaveBeenCalledTimes(1); // Only event1 attempted

      // Verify both events are stored (event2 stored but not processed)
      const eventsBeforeReprocess = await eventStore.getEvents(
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
        aggregateType,
      );
      expect(eventsBeforeReprocess).toHaveLength(2);
      expect(
        eventsBeforeReprocess.find((e) => e.id === event1.id),
      ).toBeDefined();
      expect(
        eventsBeforeReprocess.find((e) => e.id === event2.id),
      ).toBeDefined();

      // Clear checkpoint for event1 (using new per-aggregate key format)
      const checkpointKey1 = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      await checkpointStore.clearCheckpoint(tenantId, checkpointKey1);

      // Fix handler
      vi.mocked(handler.handle).mockImplementation(async () => void 0);

      // Reprocess event1 - duplicate prevention should not prevent reprocessing
      // Event is already in store, but handler should still be called
      await service.storeEvents([event1], context);

      // Verify event1 is still only stored once (duplicate prevention)
      // event2 is also in store, so total should be 2, but event1 should appear only once
      const eventsAfter = await eventStore.getEvents(
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
        aggregateType,
      );
      const event1Count = eventsAfter.filter((e) => e.id === event1.id).length;
      expect(event1Count).toBe(1); // event1 stored only once
      expect(eventsAfter).toHaveLength(2); // event1 and event2

      // Verify handler was called for reprocessing (idempotency allows reprocessing after checkpoint cleared)
      expect(handler.handle).toHaveBeenCalledTimes(2); // Once failed, once succeeded

      // Verify checkpoint was created for successful reprocessing (using new per-aggregate key format)
      const checkpointKeyAfter = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      const checkpointAfter =
        await checkpointStore.loadCheckpoint(checkpointKeyAfter);
      expect(checkpointAfter).not.toBeNull();
      expect(checkpointAfter?.status).toBe("processed");
      expect(checkpointAfter?.sequenceNumber).toBe(1);

      // Now event2 should process successfully
      await service.storeEvents([event2], context);
      expect(handler.handle).toHaveBeenCalledTimes(3); // event1 (failed), event1 (reprocessed), event2
      expect(handler.handle).toHaveBeenLastCalledWith(event2);

      // Verify both events are stored
      const finalEvents = await eventStore.getEvents(
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
        aggregateType,
      );
      expect(finalEvents).toHaveLength(2);
    });
  });

  describe("recovery after fixing underlying issues", () => {
    it("can recover after fixing handler logic", async () => {
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
        processorCheckpointStore: checkpointStore,
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

      // Process event - should fail
      await expect(
        service.storeEvents([event1], context),
      ).resolves.not.toThrow();

      // Identify failed event
      const failedEvents = await checkpointStore.getFailedEvents(
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        "handler",
        tenantId,
        aggregateType,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      expect(failedEvents).toHaveLength(1);

      // Clear checkpoint (simulating fix applied, using new per-aggregate key format)
      const checkpointKey1 = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      await checkpointStore.clearCheckpoint(tenantId, checkpointKey1);

      // Fix handler (bug fixed) - change behavior without resetting to preserve call history
      vi.mocked(handler.handle).mockImplementation(async () => void 0);

      // Reprocess event - should succeed
      await service.storeEvents([event1], context);

      // Verify event was processed successfully
      expect(handler.handle).toHaveBeenCalledTimes(2); // Once failed, once succeeded
      expect(handler.handle).toHaveBeenLastCalledWith(event1);
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
        processorCheckpointStore: checkpointStore,
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
});
