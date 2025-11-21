import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventSourcingService } from "../eventSourcingService";
import type { Event } from "../../domain/types";
import {
  createMockEventStore,
  createMockProjectionStore,
  createMockProjectionDefinition,
  createMockEventHandler,
  createTestEvent,
  createTestTenantId,
  createTestEventStoreReadContext,
  createTestAggregateType,
  createTestProjection,
  TEST_CONSTANTS,
} from "./testHelpers";
import { EVENT_TYPES } from "../../domain/eventType";

describe("EventSourcingService - Projections", () => {
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

  describe("updateProjectionByName", () => {
    it("successfully updates projection", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      const expectedProjection = createTestProjection(
        TEST_CONSTANTS.AGGREGATE_ID,
        tenantId,
        { value: "test" },
      );
      projectionHandler.handle = vi.fn().mockResolvedValue(expectedProjection);

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

      const result = await service.updateProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(result).toEqual(expectedProjection);
      expect(eventStore.getEvents).toHaveBeenCalledWith(
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
        aggregateType,
      );
      expect(projectionHandler.handle).toHaveBeenCalledTimes(1);
      expect(projectionStore.storeProjection).toHaveBeenCalledWith(
        expectedProjection,
        context,
      );
    });

    it("fetches events from EventStore", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const events = [
        createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
          EVENT_TYPES[0],
          1000001,
        ),
      ];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      projectionHandler.handle = vi
        .fn()
        .mockResolvedValue(
          createTestProjection(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
        );

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

      await service.updateProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(eventStore.getEvents).toHaveBeenCalledWith(
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
        aggregateType,
      );
    });

    it("creates event stream with correct ordering", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
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
      projectionHandler.handle = vi
        .fn()
        .mockResolvedValue(
          createTestProjection(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
        );

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

      expect(projectionHandler.handle).toHaveBeenCalledTimes(1);
      const mockCalls = (projectionHandler.handle as ReturnType<typeof vi.fn>)
        .mock.calls;
      expect(mockCalls[0]).toBeDefined();
      const stream = mockCalls[0]![0];
      const streamEvents = stream.getEvents();
      expect(streamEvents[0]?.timestamp).toBe(1000000);
      expect(streamEvents[1]?.timestamp).toBe(1000001);
      expect(streamEvents[2]?.timestamp).toBe(1000002);
    });

    it("calls projection handler with stream", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      projectionHandler.handle = vi
        .fn()
        .mockResolvedValue(
          createTestProjection(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
        );

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

      await service.updateProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(projectionHandler.handle).toHaveBeenCalledTimes(1);
      const mockCalls = (projectionHandler.handle as ReturnType<typeof vi.fn>)
        .mock.calls;
      expect(mockCalls[0]).toBeDefined();
      const stream = mockCalls[0]![0];
      expect(stream.getAggregateId()).toBe(TEST_CONSTANTS.AGGREGATE_ID);
      expect(stream.getTenantId()).toBe(tenantId);
    });

    it("stores projection via ProjectionStore", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];
      const expectedProjection = createTestProjection(
        TEST_CONSTANTS.AGGREGATE_ID,
        tenantId,
        { value: "test" },
      );

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      projectionHandler.handle = vi.fn().mockResolvedValue(expectedProjection);

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

      await service.updateProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(projectionStore.storeProjection).toHaveBeenCalledWith(
        expectedProjection,
        context,
      );
    });

    it("returns updated projection", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];
      const expectedProjection = createTestProjection(
        TEST_CONSTANTS.AGGREGATE_ID,
        tenantId,
        { value: "test" },
      );

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      projectionHandler.handle = vi.fn().mockResolvedValue(expectedProjection);

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

      const result = await service.updateProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(result).toEqual(expectedProjection);
    });

    it("throws when projection name not found", async () => {
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

    it("throws when no projections configured", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
      });

      await expect(
        service.updateProjectionByName(
          "projection",
          TEST_CONSTANTS.AGGREGATE_ID,
          context,
        ),
      ).rejects.toThrow(
        "EventSourcingService.updateProjectionByName requires multiple projections to be configured",
      );
    });

    it("handles projection handler errors gracefully", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      const handlerError = new Error("Handler failed");
      projectionHandler.handle = vi.fn().mockRejectedValue(handlerError);

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
      ).rejects.toThrow("Handler failed");

      expect(projectionStore.storeProjection).not.toHaveBeenCalled();
    });

    it("handles projection store errors gracefully", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];
      const projection = createTestProjection(
        TEST_CONSTANTS.AGGREGATE_ID,
        tenantId,
      );

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      projectionHandler.handle = vi.fn().mockResolvedValue(projection);
      const storeError = new Error("Store failed");
      projectionStore.storeProjection = vi.fn().mockRejectedValue(storeError);

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
      ).rejects.toThrow("Store failed");
    });
  });

  describe("getProjectionByName", () => {
    it("retrieves projection from store", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionStore = createMockProjectionStore<any>();
      const expectedProjection = createTestProjection(
        TEST_CONSTANTS.AGGREGATE_ID,
        tenantId,
        { value: "test" },
      );

      projectionStore.getProjection = vi
        .fn()
        .mockResolvedValue(expectedProjection);

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            createMockEventHandler(),
            projectionStore,
          ),
        },
      });

      const result = await service.getProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(result).toEqual(expectedProjection);
      expect(projectionStore.getProjection).toHaveBeenCalledWith(
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );
    });

    it("uses correct context", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionStore = createMockProjectionStore<any>();
      const customContext = createTestEventStoreReadContext(tenantId, {
        custom: "metadata",
      });

      projectionStore.getProjection = vi.fn().mockResolvedValue(null);

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            createMockEventHandler(),
            projectionStore,
          ),
        },
      });

      await service.getProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        customContext,
      );

      expect(projectionStore.getProjection).toHaveBeenCalledWith(
        TEST_CONSTANTS.AGGREGATE_ID,
        customContext,
      );
    });

    it("returns null when projection doesn't exist", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionStore = createMockProjectionStore<any>();

      projectionStore.getProjection = vi.fn().mockResolvedValue(null);

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            createMockEventHandler(),
            projectionStore,
          ),
        },
      });

      const result = await service.getProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(result).toBeNull();
    });

    it("throws when projection name not found", async () => {
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
        service.getProjectionByName(
          "nonexistent",
          TEST_CONSTANTS.AGGREGATE_ID,
          context,
        ),
      ).rejects.toThrow('Projection "nonexistent" not found');
    });

    it("throws when no projections configured", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
      });

      await expect(
        service.getProjectionByName(
          "projection",
          TEST_CONSTANTS.AGGREGATE_ID,
          context,
        ),
      ).rejects.toThrow(
        "EventSourcingService.getProjectionByName requires multiple projections to be configured",
      );
    });
  });

  describe("hasProjectionByName", () => {
    it("returns true when projection exists", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionStore = createMockProjectionStore<any>();
      const projection = createTestProjection(
        TEST_CONSTANTS.AGGREGATE_ID,
        tenantId,
      );

      projectionStore.getProjection = vi.fn().mockResolvedValue(projection);

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            createMockEventHandler(),
            projectionStore,
          ),
        },
      });

      const result = await service.hasProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(result).toBe(true);
    });

    it("returns false when projection doesn't exist", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionStore = createMockProjectionStore<any>();

      projectionStore.getProjection = vi.fn().mockResolvedValue(null);

      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            createMockEventHandler(),
            projectionStore,
          ),
        },
      });

      const result = await service.hasProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(result).toBe(false);
    });

    it("throws when projection name not found", async () => {
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
        service.hasProjectionByName(
          "nonexistent",
          TEST_CONSTANTS.AGGREGATE_ID,
          context,
        ),
      ).rejects.toThrow('Projection "nonexistent" not found');
    });

    it("throws when no projections configured", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
      });

      await expect(
        service.hasProjectionByName(
          "projection",
          TEST_CONSTANTS.AGGREGATE_ID,
          context,
        ),
      ).rejects.toThrow(
        "EventSourcingService.hasProjectionByName requires multiple projections to be configured",
      );
    });
  });

  describe("getProjectionNames", () => {
    it("returns all registered projection names", () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
        projections: {
          projection1: createMockProjectionDefinition(
            "projection1",
            createMockEventHandler(),
            createMockProjectionStore(),
          ),
          projection2: createMockProjectionDefinition(
            "projection2",
            createMockEventHandler(),
            createMockProjectionStore(),
          ),
          projection3: createMockProjectionDefinition(
            "projection3",
            createMockEventHandler(),
            createMockProjectionStore(),
          ),
        },
      });

      const names = service.getProjectionNames();

      expect(names).toHaveLength(3);
      expect(names).toContain("projection1");
      expect(names).toContain("projection2");
      expect(names).toContain("projection3");
    });

    it("returns empty array when no projections", () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        aggregateType,
        eventStore,
      });

      const names = service.getProjectionNames();

      expect(names).toEqual([]);
    });
  });

  describe("updateProjectionsForAggregates", () => {
    it("groups events by aggregateId correctly", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();

      const aggregate1 = "aggregate-1";
      const aggregate2 = "aggregate-2";
      const events = [
        createTestEvent(aggregate1, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
        createTestEvent(aggregate2, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
        createTestEvent(aggregate1, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
      ];

      eventStore.getEvents = vi.fn().mockImplementation((aggId) => {
        return Promise.resolve(events.filter((e) => e.aggregateId === aggId));
      });
      projectionHandler.handle = vi
        .fn()
        .mockResolvedValue(createTestProjection(aggregate1, tenantId));

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

      await service.storeEvents(events, context);

      // Should be called for each unique aggregate
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

    it("updates all projections for each aggregate", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler1 = createMockEventHandler<Event, any>();
      const projectionHandler2 = createMockEventHandler<Event, any>();
      const projectionStore1 = createMockProjectionStore<any>();
      const projectionStore2 = createMockProjectionStore<any>();
      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      projectionHandler1.handle = vi
        .fn()
        .mockResolvedValue(
          createTestProjection(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
        );
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

      await service.storeEvents(events, context);

      expect(projectionHandler1.handle).toHaveBeenCalledTimes(1);
      expect(projectionHandler2.handle).toHaveBeenCalledTimes(1);
      expect(projectionStore1.storeProjection).toHaveBeenCalledTimes(1);
      expect(projectionStore2.storeProjection).toHaveBeenCalledTimes(1);
    });

    it("handles multiple aggregates", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();

      const aggregate1 = "aggregate-1";
      const aggregate2 = "aggregate-2";
      const events = [
        createTestEvent(aggregate1, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
        createTestEvent(aggregate2, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
      ];

      eventStore.getEvents = vi.fn().mockImplementation((aggId) => {
        return Promise.resolve(events.filter((e) => e.aggregateId === aggId));
      });
      projectionHandler.handle = vi
        .fn()
        .mockResolvedValue(createTestProjection(aggregate1, tenantId));

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

      await service.storeEvents(events, context);

      expect(eventStore.getEvents).toHaveBeenCalledTimes(2);
      expect(projectionHandler.handle).toHaveBeenCalledTimes(2);
    });

    it("handles empty events array", async () => {
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

      expect(eventStore.getEvents).not.toHaveBeenCalled();
      expect(projectionHandler.handle).not.toHaveBeenCalled();
    });
  });
});
