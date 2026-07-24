import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventStoreMemory } from "../../stores/eventStoreMemory";
import { EventRepositoryMemory } from "../../stores/repositories/eventRepositoryMemory";
import { EVENT_TYPES } from "../../domain/eventType";
import type { Event } from "../../domain/types";
import { EventSourcingService } from "../eventSourcingService";
import {
  cleanupTestEnvironment,
  createMockMapProjectionDefinition,
  createTestContext,
  createTestEvent,
  setupTestEnvironment,
  TEST_CONSTANTS,
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

  describe("when handlers process events independently (no sequential ordering)", () => {
    it("processes events regardless of order - no sequence enforcement", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const mapDef = createMockMapProjectionDefinition("handler");
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        mapProjections: [mapDef],
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

      // Store event1 first (but don't process it via service yet)
      await eventStore.storeEvents([event1], context, aggregateType);

      // Process event2 before event1 - handlers no longer enforce ordering
      await service.storeEvents([event2], context);

      // Handler processes event2 independently
      expect(mapDef.map).toHaveBeenCalledTimes(1);
      expect(mapDef.map).toHaveBeenCalledWith(event2);

      // Process event1 - also succeeds
      await service.storeEvents([event1], context);

      expect(mapDef.map).toHaveBeenCalledTimes(2);
      expect(mapDef.map).toHaveBeenCalledWith(event1);
    });

    it("processes events out of order without blocking", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const mapDef = createMockMapProjectionDefinition("handler");
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        mapProjections: [mapDef],
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

      // Store all events
      await eventStore.storeEvents(
        [event1, event2, event3],
        context,
        aggregateType,
      );

      // Process events out of order: event3, event1, event2 - all succeed
      await service.storeEvents([event3], context);
      expect(mapDef.map).toHaveBeenCalledTimes(1);
      expect(mapDef.map).toHaveBeenCalledWith(event3);

      await service.storeEvents([event1], context);
      expect(mapDef.map).toHaveBeenCalledTimes(2);
      expect(mapDef.map).toHaveBeenCalledWith(event1);

      await service.storeEvents([event2], context);
      expect(mapDef.map).toHaveBeenCalledTimes(3);
      expect(mapDef.map).toHaveBeenCalledWith(event2);
    });

    it("processes first event without any prerequisite checks", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const mapDef = createMockMapProjectionDefinition("handler");
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        mapProjections: [mapDef],
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

      // Process first event - succeeds without checking for previous
      await service.storeEvents([event1], context);

      // Verify handler was called
      expect(mapDef.map).toHaveBeenCalledTimes(1);
      expect(mapDef.map).toHaveBeenCalledWith(event1);
    });

    it("handles concurrent events with same timestamp independently", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const mapDef = createMockMapProjectionDefinition("handler");
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        mapProjections: [mapDef],
      });

      // Create events with same timestamp but different IDs
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

      // Process all events - handlers process independently
      await service.storeEvents([event1], context);
      await service.storeEvents([event2], context);
      await service.storeEvents([event3], context);

      expect(mapDef.map).toHaveBeenCalledTimes(3);
      expect(mapDef.map).toHaveBeenCalledWith(event1);
      expect(mapDef.map).toHaveBeenCalledWith(event2);
      expect(mapDef.map).toHaveBeenCalledWith(event3);
    });
  });

  describe("duplicate event prevention", () => {
    it("prevents storing duplicate events in repository", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const mapDef = createMockMapProjectionDefinition("handler");
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        mapProjections: [mapDef],
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

      // Handlers process each event independently (no checkpoint-based idempotency)
      // Event is dispatched twice (once per storeEvents call), so handler is called twice
      expect(mapDef.map).toHaveBeenCalledTimes(2);
    });

    it("prevents duplicate when event stored directly then via service", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const mapDef = createMockMapProjectionDefinition("handler");
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        mapProjections: [mapDef],
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

      // Store event1 again via service (should not create duplicate in store)
      await service.storeEvents([event1], context);

      // Verify event is only stored once
      const allEvents = await eventStore.getEvents(
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
        aggregateType,
      );
      const event1Count = allEvents.filter((e) => e.id === event1.id).length;
      expect(event1Count).toBe(1);

      // Handler is called once (from the service.storeEvents call)
      expect(mapDef.map).toHaveBeenCalledTimes(1);
      expect(mapDef.map).toHaveBeenCalledWith(event1);
    });

    it("handles batch storage with duplicates correctly", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const mapDef = createMockMapProjectionDefinition("handler");
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        mapProjections: [mapDef],
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

      // Handlers process each event in the batch independently (including duplicate)
      expect(mapDef.map).toHaveBeenCalledTimes(3);
      expect(mapDef.map).toHaveBeenCalledWith(event1);
      expect(mapDef.map).toHaveBeenCalledWith(event2);
    });

    it("prevents duplicates with multiple handlers correctly", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const mapDef1 = createMockMapProjectionDefinition("handler1");
      const mapDef2 = createMockMapProjectionDefinition("handler2");
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        mapProjections: [mapDef1, mapDef2],
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

      // Handlers process each event independently (no checkpoint-based idempotency)
      // Event is dispatched twice (once per storeEvents call), so each handler is called twice
      expect(mapDef1.map).toHaveBeenCalledTimes(2);
      expect(mapDef2.map).toHaveBeenCalledTimes(2);
      expect(mapDef1.map).toHaveBeenCalledWith(event1);
      expect(mapDef2.map).toHaveBeenCalledWith(event1);
    });

    it("stores events in different aggregates separately (partition isolation)", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const mapDef = createMockMapProjectionDefinition("handler");
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        mapProjections: [mapDef],
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
      expect(mapDef.map).toHaveBeenCalledTimes(2);
      expect(mapDef.map).toHaveBeenCalledWith(event1_agg1);
      expect(mapDef.map).toHaveBeenCalledWith(event1_agg2);
    });

    it("handles batch with mixed duplicates correctly - dispatches all events to handlers", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const mapDef = createMockMapProjectionDefinition("handler");
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        mapProjections: [mapDef],
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
      expect(mapDef.map).toHaveBeenCalledTimes(1);

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

      // Handlers process all dispatched events independently
      // Total calls: 1 (initial event1) + 3 (event1 duplicate + event2 + event3) = 4
      expect(mapDef.map).toHaveBeenCalledTimes(4);
      expect(mapDef.map).toHaveBeenCalledWith(event1);
      expect(mapDef.map).toHaveBeenCalledWith(event2);
      expect(mapDef.map).toHaveBeenCalledWith(event3);
    });
  });
});
