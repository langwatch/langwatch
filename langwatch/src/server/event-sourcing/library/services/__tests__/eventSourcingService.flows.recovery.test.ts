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
  createMockFoldProjectionDefinition,
  createMockFoldProjectionStore,
  createMockMapProjectionDefinition,
  createTestContext,
  createTestEvent,
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

  describe("when map projection (handler) failures occur (no checkpoints for handlers)", () => {
    it("map projection errors are non-critical and do not block subsequent events", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const mapDef = createMockMapProjectionDefinition("handler");
      const checkpointStore = new ProcessorCheckpointStoreMemory(
        new CheckpointRepositoryMemory(),
      );
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        mapProjections: [mapDef],
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

      // Make map fail for event1
      (mapDef.map as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error("Handler failed");
        })
        .mockImplementation((event: Event) => event);

      // Process event1 - map fails but storeEvents does not throw
      await expect(
        service.storeEvents([event1], context),
      ).resolves.not.toThrow();

      // Process event2 - map projections no longer block on previous failures
      await expect(
        service.storeEvents([event2], context),
      ).resolves.not.toThrow();

      // Both events were dispatched to map (event1 failed, event2 succeeded)
      expect(mapDef.map).toHaveBeenCalledTimes(2);

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

    it("map projection failures do not create failed checkpoints", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const mapDef = createMockMapProjectionDefinition("handler");
      const checkpointStore = new ProcessorCheckpointStoreMemory(
        new CheckpointRepositoryMemory(),
      );
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        mapProjections: [mapDef],
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

      // Make map fail
      (mapDef.map as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Handler failed");
      });

      // Process event - map fails but storeEvents succeeds
      await expect(
        service.storeEvents([event1], context),
      ).resolves.not.toThrow();

      // No handler checkpoint exists (map projections no longer track checkpoints)
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

    it("multiple map projection failures do not block any events", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const mapDef = createMockMapProjectionDefinition("handler");
      const checkpointStore = new ProcessorCheckpointStoreMemory(
        new CheckpointRepositoryMemory(),
      );
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        mapProjections: [mapDef],
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

      // Make map fail for event1
      (mapDef.map as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error("Handler failed");
        })
        .mockImplementation((event: Event) => event);

      // Process event1 - map fails but storeEvents doesn't throw
      await service.storeEvents([event1], context);

      // Process event2 - succeeds (no blocking from failed map)
      await service.storeEvents([event2], context);
      expect(mapDef.map).toHaveBeenCalledTimes(2);

      // Process event3 - also succeeds
      await service.storeEvents([event3], context);
      expect(mapDef.map).toHaveBeenCalledTimes(3);
    });

    it("map projection can be retried by re-dispatching same event", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const mapDef = createMockMapProjectionDefinition("handler");
      const checkpointStore = new ProcessorCheckpointStoreMemory(
        new CheckpointRepositoryMemory(),
      );
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        mapProjections: [mapDef],
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

      // Simulate bug in map (fails)
      (mapDef.map as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Bug in handler");
      });

      // Process event - map fails
      await expect(
        service.storeEvents([event1], context),
      ).resolves.not.toThrow();

      // Fix map (bug fixed)
      (mapDef.map as ReturnType<typeof vi.fn>).mockImplementation(
        (event: Event) => event,
      );

      // Reprocess event - map succeeds this time
      await service.storeEvents([event1], context);

      // Verify event was processed twice (once failed, once succeeded)
      expect(mapDef.map).toHaveBeenCalledTimes(2);
    });
  });

  describe("when fold projection failures occur (checkpoints still used)", () => {
    it("recovery works for fold projections", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const foldDef = createMockFoldProjectionDefinition("projection");
      const checkpointStore = new ProcessorCheckpointStoreMemory(
        new CheckpointRepositoryMemory(),
      );
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
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

      // Make fold projection fail for event1 initially
      (foldDef.apply as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error("Projection failed");
        })
        .mockImplementation((state: any) => state);

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
      await expect(
        service.storeEvents([event2], context),
      ).resolves.not.toThrow();

      // Verify fold apply was only called once (for event1, which failed)
      expect(foldDef.apply).toHaveBeenCalledTimes(1);

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

      // Step 3: Fix fold projection (now succeeds)
      (foldDef.apply as ReturnType<typeof vi.fn>).mockImplementation(
        (state: any) => state,
      );

      // Step 4: Reprocess event1 - should succeed now
      await service.storeEvents([event1], context);

      // Verify fold was updated (1 from initial fail + 2 from rebuild of both events)
      expect(foldDef.apply).toHaveBeenCalledTimes(3);

      // Step 5: Reprocess event2 - should succeed now
      await service.storeEvents([event2], context);

      // Verify fold was updated again (rebuild replays both events again)
      expect(foldDef.apply).toHaveBeenCalledTimes(5);
    });

    it("can recover after fixing fold projection logic", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const foldDef = createMockFoldProjectionDefinition("projection");
      const checkpointStore = new ProcessorCheckpointStoreMemory(
        new CheckpointRepositoryMemory(),
      );
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
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

      // Simulate bug in fold projection (fails)
      (foldDef.apply as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Bug in projection handler");
      });

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

      // Fix fold projection (bug fixed)
      (foldDef.apply as ReturnType<typeof vi.fn>).mockImplementation(
        (state: any) => state,
      );

      // Reprocess event - should succeed
      await service.storeEvents([event1], context);

      // Verify fold was updated successfully
      expect(foldDef.apply).toHaveBeenCalledTimes(2); // Once failed, once succeeded
    });
  });

  describe("clearCheckpoint", () => {
    it("removes checkpoint for specific projection aggregate", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const foldDef = createMockFoldProjectionDefinition("projection");
      const checkpointStore = new ProcessorCheckpointStoreMemory(
        new CheckpointRepositoryMemory(),
      );
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
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

      // Make fold projection fail
      (foldDef.apply as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Projection failed");
      });

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

  describe("duplicate prevention does not break map projection dispatch", () => {
    it("duplicate events are dispatched to map projections even after storage dedup", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const mapDef = createMockMapProjectionDefinition("handler");
      const checkpointStore = new ProcessorCheckpointStoreMemory(
        new CheckpointRepositoryMemory(),
      );
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        mapProjections: [mapDef],
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

      // Make map fail for event1 initially then succeed
      (mapDef.map as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => {
          throw new Error("Handler failed");
        })
        .mockImplementation((event: Event) => event);

      // Process event1 - map fails but store succeeds
      await expect(
        service.storeEvents([event1], context),
      ).resolves.not.toThrow();

      // Verify event1 is stored (even though map failed)
      const eventsBefore = await eventStore.getEvents(
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
        aggregateType,
      );
      expect(eventsBefore).toHaveLength(1);
      expect(eventsBefore[0]?.id).toBe(event1.id);

      // Process event2 - succeeds (map no longer blocks on previous failures)
      await expect(
        service.storeEvents([event2], context),
      ).resolves.not.toThrow();
      expect(mapDef.map).toHaveBeenCalledTimes(2);

      // Verify both events are stored
      const eventsAfter = await eventStore.getEvents(
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
        aggregateType,
      );
      expect(eventsAfter).toHaveLength(2);

      // Fix map
      (mapDef.map as ReturnType<typeof vi.fn>).mockImplementation(
        (event: Event) => event,
      );

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

      // Map was called 3 times total: event1 (failed), event2 (ok), event1 (retry ok)
      expect(mapDef.map).toHaveBeenCalledTimes(3);
    });
  });
});
