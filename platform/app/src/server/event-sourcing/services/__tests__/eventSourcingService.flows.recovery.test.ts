import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventStoreMemory } from "../../stores/eventStoreMemory";
import { EventRepositoryMemory } from "../../stores/repositories/eventRepositoryMemory";
import { EVENT_TYPES } from "../../domain/eventType";
import type { Event } from "../../domain/types";
import { EventSourcingService } from "../eventSourcingService";
import {
  cleanupTestEnvironment,
  createMockFoldProjectionDefinition,
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

  describe("when map projection (handler) failures occur", () => {
    it("map projection errors are non-critical and do not block subsequent events", async () => {
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
    });

    it("multiple map projection failures do not block any events", async () => {
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

  describe("when fold projection failures occur", () => {
    it("fold projection errors are caught and do not fail storeEvents", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const foldDef = createMockFoldProjectionDefinition("projection");
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
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

      // Process event - fold fails but storeEvents does not throw
      await expect(
        service.storeEvents([event1], context),
      ).resolves.not.toThrow();

      // Verify fold was attempted
      expect(foldDef.apply).toHaveBeenCalledTimes(1);
    });
  });

  describe("duplicate prevention does not break map projection dispatch", () => {
    it("duplicate events are dispatched to map projections even after storage dedup", async () => {
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

      // Reprocess event1 - just re-dispatch
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
