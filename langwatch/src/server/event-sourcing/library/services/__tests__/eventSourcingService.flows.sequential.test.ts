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
  createMockDistributedLock,
} from "./testHelpers";

describe("EventSourcingService - Sequential Ordering Flows", () => {
  const { aggregateType, tenantId, eventVersion, context } =
    createTestContext();

  beforeEach(() => {
    setupTestEnvironment();
  });

  afterEach(() => {
    cleanupTestEnvironment();
  });

  describe("sequential ordering enforcement for handlers", () => {
    it("event N+1 waits for event N to be processed", async () => {
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
        distributedLock: createMockDistributedLock(),
      });

      // Create events with timestamps that will result in sequence numbers 1, 2, 3
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

      // Store event1 first (but don't process it yet - simulate it being stored but not processed)
      await eventStore.storeEvents([event1], context, aggregateType);

      // Try to process event2 (sequence 2) before event1 (sequence 1) is processed
      // This should fail because event1 hasn't been processed yet
      await expect(service.storeEvents([event2], context)).rejects.toThrow(
        "Previous event (sequence 1) has not been processed yet",
      );

      // Verify event2 handler was not called
      expect(handler.handle).not.toHaveBeenCalled();

      // Now process event1 (sequence 1) - should succeed
      await service.storeEvents([event1], context);

      // Verify event1 was processed
      expect(handler.handle).toHaveBeenCalledTimes(1);
      expect(handler.handle).toHaveBeenCalledWith(event1);

      // Verify checkpoint for aggregate was saved as processed (checkpoint is per aggregate, not per event)
      const checkpointKey1 = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      const checkpoint1 = await checkpointStore.loadCheckpoint(checkpointKey1);
      expect(checkpoint1).not.toBeNull();
      expect(checkpoint1?.status).toBe("processed");
      expect(checkpoint1?.sequenceNumber).toBe(1);

      // Now process event2 (sequence 2) - should succeed because event1 is processed
      await service.storeEvents([event2], context);

      // Verify event2 was processed
      expect(handler.handle).toHaveBeenCalledTimes(2);
      expect(handler.handle).toHaveBeenCalledWith(event2);

      // Verify checkpoint for aggregate was updated (same key, updated sequence number)
      const checkpointKey2 = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      const checkpoint2 = await checkpointStore.loadCheckpoint(checkpointKey2);
      expect(checkpoint2).not.toBeNull();
      expect(checkpoint2?.status).toBe("processed");
      expect(checkpoint2?.sequenceNumber).toBe(2);
    });

    it("events arriving out of order are processed in correct sequence", async () => {
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
        distributedLock: createMockDistributedLock(),
      });

      // Create events with different timestamps
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

      // Store all events
      await eventStore.storeEvents(
        [event1, event2, event3],
        context,
        aggregateType,
      );

      // Process events out of order: event3, then event1, then event2
      // event3 should fail (waiting for event2, which is the immediate predecessor)
      await expect(service.storeEvents([event3], context)).rejects.toThrow(
        /Previous event \(sequence \d+\) has not been processed yet/,
      );

      // event2 should fail (waiting for event1)
      await expect(service.storeEvents([event2], context)).rejects.toThrow(
        "Previous event (sequence 1) has not been processed yet",
      );

      // event1 should succeed (first event, no previous)
      await service.storeEvents([event1], context);
      expect(handler.handle).toHaveBeenCalledTimes(1);
      expect(handler.handle).toHaveBeenCalledWith(event1);

      // Now event2 should succeed
      await service.storeEvents([event2], context);
      expect(handler.handle).toHaveBeenCalledTimes(2);
      expect(handler.handle).toHaveBeenCalledWith(event2);

      // Now event3 should succeed
      await service.storeEvents([event3], context);
      expect(handler.handle).toHaveBeenCalledTimes(3);
      expect(handler.handle).toHaveBeenCalledWith(event3);
    });

    it("first event (sequence 1) doesn't check for previous event", async () => {
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
        distributedLock: createMockDistributedLock(),
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

      // Process first event - should succeed without checking for previous
      await service.storeEvents([event1], context);

      // Verify handler was called
      expect(handler.handle).toHaveBeenCalledTimes(1);
      expect(handler.handle).toHaveBeenCalledWith(event1);

      // Verify checkpoint was saved
      const checkpointKey1 = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      const checkpoint1 = await checkpointStore.loadCheckpoint(checkpointKey1);
      expect(checkpoint1).not.toBeNull();
      expect(checkpoint1?.status).toBe("processed");
      expect(checkpoint1?.sequenceNumber).toBe(1);
    });

    it("sequence number computation with real event data", async () => {
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
        distributedLock: createMockDistributedLock(),
      });

      // Create multiple events with different timestamps
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

      // Store all events
      await eventStore.storeEvents(
        [event1, event2, event3],
        context,
        aggregateType,
      );

      // Process events in order and verify sequence numbers after each
      const checkpointKey = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );

      // Process event1 and verify sequence number is 1
      await service.storeEvents([event1], context);
      const checkpoint1 = await checkpointStore.loadCheckpoint(checkpointKey);
      expect(checkpoint1).not.toBeNull();
      expect(checkpoint1?.sequenceNumber).toBe(1);
      expect(checkpoint1?.status).toBe("processed");

      // Process event2 and verify sequence number is 2
      await service.storeEvents([event2], context);
      const checkpoint2 = await checkpointStore.loadCheckpoint(checkpointKey);
      expect(checkpoint2).not.toBeNull();
      expect(checkpoint2?.sequenceNumber).toBe(2);
      expect(checkpoint2?.status).toBe("processed");

      // Process event3 and verify sequence number is 3
      await service.storeEvents([event3], context);
      const checkpoint3 = await checkpointStore.loadCheckpoint(checkpointKey);
      expect(checkpoint3).not.toBeNull();
      expect(checkpoint3?.sequenceNumber).toBe(3);
      expect(checkpoint3?.status).toBe("processed");
    });

    it("concurrent events with same timestamp get correct sequence numbers", async () => {
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
        distributedLock: createMockDistributedLock(),
      });

      // Create events with same timestamp but different IDs (sorted by ID)
      const sameTimestamp = TEST_CONSTANTS.BASE_TIMESTAMP;
      const event1 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        sameTimestamp,
        eventVersion,
        {},
        `${sameTimestamp}:${tenantId}:${TEST_CONSTANTS.AGGREGATE_ID}:${aggregateType}:a`,
      );
      const event2 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        sameTimestamp,
        eventVersion,
        {},
        `${sameTimestamp}:${tenantId}:${TEST_CONSTANTS.AGGREGATE_ID}:${aggregateType}:b`,
      );
      const event3 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        sameTimestamp,
        eventVersion,
        {},
        `${sameTimestamp}:${tenantId}:${TEST_CONSTANTS.AGGREGATE_ID}:${aggregateType}:c`,
      );

      // Store all events
      await eventStore.storeEvents(
        [event1, event2, event3],
        context,
        aggregateType,
      );

      // Process events in order and verify sequence numbers after each
      const checkpointKey = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );

      // Process event1 and verify sequence number is 1 (id ending in :a)
      await service.storeEvents([event1], context);
      const checkpoint1 = await checkpointStore.loadCheckpoint(checkpointKey);
      expect(checkpoint1).not.toBeNull();
      expect(checkpoint1?.sequenceNumber).toBe(1);
      expect(checkpoint1?.status).toBe("processed");

      // Process event2 and verify sequence number is 2 (id ending in :b)
      await service.storeEvents([event2], context);
      const checkpoint2 = await checkpointStore.loadCheckpoint(checkpointKey);
      expect(checkpoint2).not.toBeNull();
      expect(checkpoint2?.sequenceNumber).toBe(2);
      expect(checkpoint2?.status).toBe("processed");

      // Process event3 and verify sequence number is 3 (id ending in :c)
      await service.storeEvents([event3], context);
      const checkpoint3 = await checkpointStore.loadCheckpoint(checkpointKey);
      expect(checkpoint3).not.toBeNull();
      expect(checkpoint3?.sequenceNumber).toBe(3);
      expect(checkpoint3?.status).toBe("processed");
    });
  });

  describe("sequential ordering enforcement for projections", () => {
    it("event N+1 waits for event N to be processed for projections", async () => {
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
        distributedLock: createMockDistributedLock(),
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

      // Store all events
      await eventStore.storeEvents([event1, event2], context, aggregateType);

      // Mock projection handler to return a projection
      projectionHandler.handle = vi
        .fn()
        .mockResolvedValue(
          createTestProjection(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
        );

      // Try to process event2 before event1 - should fail
      await expect(service.storeEvents([event2], context)).rejects.toThrow(
        "Previous event (sequence 1) has not been processed yet",
      );

      // Verify projection handler was not called
      expect(projectionHandler.handle).not.toHaveBeenCalled();

      // Process event1 - should succeed
      await service.storeEvents([event1], context);

      // Verify projection was updated
      expect(projectionHandler.handle).toHaveBeenCalledTimes(1);
      const checkpointKey1 = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "projection",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      const checkpoint1 = await checkpointStore.loadCheckpoint(checkpointKey1);
      expect(checkpoint1).not.toBeNull();
      expect(checkpoint1?.status).toBe("processed");
      expect(checkpoint1?.sequenceNumber).toBe(1);

      // Now process event2 - should succeed
      await service.storeEvents([event2], context);

      // Verify projection was updated again
      expect(projectionHandler.handle).toHaveBeenCalledTimes(2);
      const checkpointKey2 = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "projection",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      const checkpoint2 = await checkpointStore.loadCheckpoint(checkpointKey2);
      expect(checkpoint2).not.toBeNull();
      expect(checkpoint2?.status).toBe("processed");
      expect(checkpoint2?.sequenceNumber).toBe(2);
    });

    it("first event (sequence 1) doesn't check for previous event for projections", async () => {
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
        distributedLock: createMockDistributedLock(),
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

      // Mock projection handler
      projectionHandler.handle = vi
        .fn()
        .mockResolvedValue(
          createTestProjection(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
        );

      // Process first event - should succeed without checking for previous
      await service.storeEvents([event1], context);

      // Verify projection handler was called
      expect(projectionHandler.handle).toHaveBeenCalledTimes(1);

      // Verify checkpoint was saved
      const checkpointKey1 = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "projection",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      const checkpoint1 = await checkpointStore.loadCheckpoint(checkpointKey1);
      expect(checkpoint1).not.toBeNull();
      expect(checkpoint1?.status).toBe("processed");
      expect(checkpoint1?.sequenceNumber).toBe(1);
    });
  });

  describe("sequence number edge cases", () => {
    it("events with identical timestamps get sequential numbers based on ID", async () => {
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
        distributedLock: createMockDistributedLock(),
      });

      const sameTimestamp = TEST_CONSTANTS.BASE_TIMESTAMP;
      // Create events with same timestamp, IDs will determine order
      const eventA = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        sameTimestamp,
        eventVersion,
        {},
        `event-a-${sameTimestamp}`,
      );
      const eventB = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        sameTimestamp,
        eventVersion,
        {},
        `event-b-${sameTimestamp}`,
      );
      const eventC = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        sameTimestamp,
        eventVersion,
        {},
        `event-c-${sameTimestamp}`,
      );

      // Store all events
      await eventStore.storeEvents(
        [eventA, eventB, eventC],
        context,
        aggregateType,
      );

      // Process events and verify sequence numbers after each
      const checkpointKey = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );

      // Process eventA and verify sequence number is 1 (a < b < c)
      await service.storeEvents([eventA], context);
      const checkpointA = await checkpointStore.loadCheckpoint(checkpointKey);
      expect(checkpointA).not.toBeNull();
      expect(checkpointA?.sequenceNumber).toBe(1);
      expect(checkpointA?.status).toBe("processed");

      // Process eventB and verify sequence number is 2
      await service.storeEvents([eventB], context);
      const checkpointB = await checkpointStore.loadCheckpoint(checkpointKey);
      expect(checkpointB).not.toBeNull();
      expect(checkpointB?.sequenceNumber).toBe(2);
      expect(checkpointB?.status).toBe("processed");

      // Process eventC and verify sequence number is 3
      await service.storeEvents([eventC], context);
      const checkpointC = await checkpointStore.loadCheckpoint(checkpointKey);
      expect(checkpointC).not.toBeNull();
      expect(checkpointC?.sequenceNumber).toBe(3);
      expect(checkpointC?.status).toBe("processed");
    });

    it("sequence numbers are deterministic (same events = same sequence numbers)", async () => {
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
        distributedLock: createMockDistributedLock(),
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

      // Process events and capture sequence numbers
      await service.storeEvents([event1], context);
      const checkpointKey1 = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      const checkpoint1 = await checkpointStore.loadCheckpoint(checkpointKey1);
      const seq1 = checkpoint1?.sequenceNumber;

      await service.storeEvents([event2], context);
      const checkpointKey2 = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      const checkpoint2 = await checkpointStore.loadCheckpoint(checkpointKey2);
      const seq2 = checkpoint2?.sequenceNumber;

      // Verify sequence numbers are as expected
      expect(seq1).toBe(1);
      expect(seq2).toBe(2);

      // Create a new service instance and process same events
      const eventStore2 = new EventStoreMemory<Event>();
      const checkpointStore2 = new ProcessorCheckpointStoreMemory();
      const service2 = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore: eventStore2,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
        processorCheckpointStore: checkpointStore2,
        distributedLock: createMockDistributedLock(),
      });

      // Store same events
      await eventStore2.storeEvents([event1, event2], context, aggregateType);

      // Process events and check sequence numbers after each
      // Reuse checkpointKey2 from above since it's the same key

      // Process event1 and check sequence number
      await service2.storeEvents([event1], context);
      const checkpoint1_2 =
        await checkpointStore2.loadCheckpoint(checkpointKey2);
      const seq1_2 = checkpoint1_2?.sequenceNumber;

      // Process event2 and check sequence number
      await service2.storeEvents([event2], context);
      const checkpoint2_2 =
        await checkpointStore2.loadCheckpoint(checkpointKey2);
      const seq2_2 = checkpoint2_2?.sequenceNumber;

      // Verify sequence numbers are the same
      expect(seq1_2).toBe(1);
      expect(seq2_2).toBe(2);
    });

    it("sequence numbers are stable across rebuilds", async () => {
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
        distributedLock: createMockDistributedLock(),
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

      // Mock projection handler
      projectionHandler.handle = vi
        .fn()
        .mockResolvedValue(
          createTestProjection(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
        );

      // Process events and get sequence numbers after each
      const checkpointKey = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "projection",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );

      // Process event1 and get sequence number
      await service.storeEvents([event1], context);
      const checkpoint1 = await checkpointStore.loadCheckpoint(checkpointKey);
      const seq1 = checkpoint1?.sequenceNumber;

      // Process event2 and get sequence number
      await service.storeEvents([event2], context);
      const checkpoint2 = await checkpointStore.loadCheckpoint(checkpointKey);
      const seq2 = checkpoint2?.sequenceNumber;

      // Clear checkpoint and rebuild
      await checkpointStore.clearCheckpoint(tenantId, checkpointKey);

      // Rebuild projections (process events again) and check sequence numbers after each
      await service.storeEvents([event1], context);
      const checkpoint1_2 = await checkpointStore.loadCheckpoint(checkpointKey);
      const seq1_2 = checkpoint1_2?.sequenceNumber;

      await service.storeEvents([event2], context);
      const checkpoint2_2 = await checkpointStore.loadCheckpoint(checkpointKey);
      const seq2_2 = checkpoint2_2?.sequenceNumber;

      // Verify sequence numbers are the same
      expect(seq1_2).toBe(seq1);
      expect(seq2_2).toBe(seq2);
    });

    it("multiple events with same timestamp processed correctly", async () => {
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
        distributedLock: createMockDistributedLock(),
      });

      const sameTimestamp = TEST_CONSTANTS.BASE_TIMESTAMP;
      const event1 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        sameTimestamp,
        eventVersion,
        {},
        `id-1-${sameTimestamp}`,
      );
      const event2 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        sameTimestamp,
        eventVersion,
        {},
        `id-2-${sameTimestamp}`,
      );
      const event3 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        sameTimestamp,
        eventVersion,
        {},
        `id-3-${sameTimestamp}`,
      );

      // Store all events
      await eventStore.storeEvents(
        [event1, event2, event3],
        context,
        aggregateType,
      );

      // Process events in order and verify sequence numbers after each
      const checkpointKey = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );

      // Process event1 and verify sequence number is 1
      await service.storeEvents([event1], context);
      const checkpoint1 = await checkpointStore.loadCheckpoint(checkpointKey);
      expect(checkpoint1).not.toBeNull();
      expect(checkpoint1?.sequenceNumber).toBe(1);
      expect(checkpoint1?.status).toBe("processed");

      // Process event2 and verify sequence number is 2
      await service.storeEvents([event2], context);
      const checkpoint2 = await checkpointStore.loadCheckpoint(checkpointKey);
      expect(checkpoint2).not.toBeNull();
      expect(checkpoint2?.sequenceNumber).toBe(2);
      expect(checkpoint2?.status).toBe("processed");

      // Process event3 and verify sequence number is 3
      await service.storeEvents([event3], context);
      const checkpoint3 = await checkpointStore.loadCheckpoint(checkpointKey);
      expect(checkpoint3).not.toBeNull();
      expect(checkpoint3?.sequenceNumber).toBe(3);
      expect(checkpoint3?.status).toBe("processed");

      // Verify handler was called for all events
      expect(handler.handle).toHaveBeenCalledTimes(3);
    });
  });

  describe("duplicate event prevention", () => {
    it("prevents storing duplicate events in repository", async () => {
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
        distributedLock: createMockDistributedLock(),
      });

      const event1 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        TEST_CONSTANTS.BASE_TIMESTAMP,
      );

      // Store event1 via service (stores and processes)
      await service.storeEvents([event1], context);

      // Try to store event1 again via service
      await service.storeEvents([event1], context);

      // Verify event is only stored once in the repository
      const allEvents = await eventStore.getEvents(
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
        aggregateType,
      );
      const event1Count = allEvents.filter((e) => e.id === event1.id).length;
      expect(event1Count).toBe(1);

      // Verify handler was only called once (idempotency check)
      expect(handler.handle).toHaveBeenCalledTimes(1);
    });

    it("prevents duplicate when event stored directly then via service", async () => {
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
        distributedLock: createMockDistributedLock(),
      });

      const event1 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        TEST_CONSTANTS.BASE_TIMESTAMP,
      );

      // Store event1 directly in event store
      await eventStore.storeEvents([event1], context, aggregateType);

      // Store event1 again via service (should not create duplicate)
      await service.storeEvents([event1], context);

      // Verify event is only stored once
      const allEvents = await eventStore.getEvents(
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
        aggregateType,
      );
      const event1Count = allEvents.filter((e) => e.id === event1.id).length;
      expect(event1Count).toBe(1);

      // Verify sequence number is correct (should be 1, not affected by duplicate attempt)
      const checkpointKey1 = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      const checkpoint1 = await checkpointStore.loadCheckpoint(checkpointKey1);
      expect(checkpoint1).not.toBeNull();
      expect(checkpoint1?.sequenceNumber).toBe(1);
      expect(checkpoint1?.status).toBe("processed");
    });

    it("handles batch storage with duplicates correctly", async () => {
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
        distributedLock: createMockDistributedLock(),
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

      // Store batch with duplicate event1
      await service.storeEvents([event1, event2, event1], context);

      // Verify each event is only stored once
      const allEvents = await eventStore.getEvents(
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
        aggregateType,
      );
      expect(allEvents).toHaveLength(2);
      expect(allEvents.find((e) => e.id === event1.id)).toBeDefined();
      expect(allEvents.find((e) => e.id === event2.id)).toBeDefined();

      // Verify handler was called for each unique event
      expect(handler.handle).toHaveBeenCalledTimes(2);
      expect(handler.handle).toHaveBeenCalledWith(event1);
      expect(handler.handle).toHaveBeenCalledWith(event2);

      // Verify final checkpoint has correct sequence number (2, since there are 2 unique events)
      const checkpointKey = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      const checkpoint = await checkpointStore.loadCheckpoint(checkpointKey);
      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.sequenceNumber).toBe(2);
      expect(checkpoint?.status).toBe("processed");
    });

    it("prevents duplicates with multiple handlers correctly", async () => {
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
        distributedLock: createMockDistributedLock(),
      });

      const event1 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        TEST_CONSTANTS.BASE_TIMESTAMP,
      );

      // Store event1 via service (both handlers should process)
      await service.storeEvents([event1], context);

      // Try to store event1 again via service
      await service.storeEvents([event1], context);

      // Verify event is only stored once in the repository
      const allEvents = await eventStore.getEvents(
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
        aggregateType,
      );
      const event1Count = allEvents.filter((e) => e.id === event1.id).length;
      expect(event1Count).toBe(1);

      // Verify both handlers were only called once each (idempotency)
      expect(handler1.handle).toHaveBeenCalledTimes(1);
      expect(handler2.handle).toHaveBeenCalledTimes(1);
      expect(handler1.handle).toHaveBeenCalledWith(event1);
      expect(handler2.handle).toHaveBeenCalledWith(event1);

      // Verify checkpoints exist for both handlers
      const checkpoint1_handler1 = await checkpointStore.loadCheckpoint(
        buildCheckpointKey(
          tenantId,
          TEST_CONSTANTS.PIPELINE_NAME,
          "handler1",
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.AGGREGATE_ID,
        ),
      );
      const checkpoint1_handler2 = await checkpointStore.loadCheckpoint(
        buildCheckpointKey(
          tenantId,
          TEST_CONSTANTS.PIPELINE_NAME,
          "handler2",
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.AGGREGATE_ID,
        ),
      );
      expect(checkpoint1_handler1).not.toBeNull();
      expect(checkpoint1_handler2).not.toBeNull();
      expect(checkpoint1_handler1?.status).toBe("processed");
      expect(checkpoint1_handler2?.status).toBe("processed");
    });

    it("stores events in different aggregates separately (partition isolation)", async () => {
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
        distributedLock: createMockDistributedLock(),
      });

      const aggregateId1 = "aggregate-1";
      const aggregateId2 = "aggregate-2";
      const sameTimestamp = TEST_CONSTANTS.BASE_TIMESTAMP;

      // Create events for different aggregates (will have different IDs due to different aggregate IDs)
      const event1_agg1 = createTestEvent(
        aggregateId1,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        sameTimestamp,
      );
      const event1_agg2 = createTestEvent(
        aggregateId2,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        sameTimestamp,
      );

      // Verify they have different IDs (due to different aggregate IDs in ID generation)
      expect(event1_agg1.id).not.toBe(event1_agg2.id);

      // Store event for aggregate1
      await service.storeEvents([event1_agg1], context);

      // Store event for aggregate2 (should be stored separately - different partition)
      await service.storeEvents([event1_agg2], context);

      // Verify both events are stored (they're in different partitions)
      const events_agg1 = await eventStore.getEvents(
        aggregateId1,
        context,
        aggregateType,
      );
      const events_agg2 = await eventStore.getEvents(
        aggregateId2,
        context,
        aggregateType,
      );
      expect(events_agg1).toHaveLength(1);
      expect(events_agg2).toHaveLength(1);
      expect(events_agg1[0]?.id).toBe(event1_agg1.id);
      expect(events_agg2[0]?.id).toBe(event1_agg2.id);

      // Verify both handlers were called (different aggregates = different partitions)
      expect(handler.handle).toHaveBeenCalledTimes(2);
      expect(handler.handle).toHaveBeenCalledWith(event1_agg1);
      expect(handler.handle).toHaveBeenCalledWith(event1_agg2);

      // Verify checkpoints exist for both events (different event IDs)
      const checkpoint1 = await checkpointStore.loadCheckpoint(
        buildCheckpointKey(
          tenantId,
          TEST_CONSTANTS.PIPELINE_NAME,
          "handler",
          TEST_CONSTANTS.AGGREGATE_TYPE,
          aggregateId1,
        ),
      );
      const checkpoint2 = await checkpointStore.loadCheckpoint(
        buildCheckpointKey(
          tenantId,
          TEST_CONSTANTS.PIPELINE_NAME,
          "handler",
          TEST_CONSTANTS.AGGREGATE_TYPE,
          aggregateId2,
        ),
      );
      expect(checkpoint1).not.toBeNull();
      expect(checkpoint2).not.toBeNull();
    });

    it("handles batch with mixed duplicates correctly - only processes new events", async () => {
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
        distributedLock: createMockDistributedLock(),
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

      // Store event1 first
      await service.storeEvents([event1], context);
      expect(handler.handle).toHaveBeenCalledTimes(1);

      // Store batch with event1 (duplicate), event2 (new), event3 (new)
      await service.storeEvents([event1, event2, event3], context);

      // Verify all events are stored (event1 once, event2 once, event3 once)
      const allEvents = await eventStore.getEvents(
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
        aggregateType,
      );
      expect(allEvents).toHaveLength(3);
      expect(allEvents.find((e) => e.id === event1.id)).toBeDefined();
      expect(allEvents.find((e) => e.id === event2.id)).toBeDefined();
      expect(allEvents.find((e) => e.id === event3.id)).toBeDefined();

      // Verify handler was called for event2 and event3 only (event1 already processed)
      // Total calls: 1 (initial event1) + 2 (event2, event3) = 3
      expect(handler.handle).toHaveBeenCalledTimes(3);
      expect(handler.handle).toHaveBeenCalledWith(event1);
      expect(handler.handle).toHaveBeenCalledWith(event2);
      expect(handler.handle).toHaveBeenCalledWith(event3);

      // Verify final checkpoint has correct sequence number (3, since there are 3 unique events)
      const checkpointKey = buildCheckpointKey(
        tenantId,
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      const checkpoint = await checkpointStore.loadCheckpoint(checkpointKey);
      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.status).toBe("processed");
      expect(checkpoint?.sequenceNumber).toBe(3);
    });
  });
});
