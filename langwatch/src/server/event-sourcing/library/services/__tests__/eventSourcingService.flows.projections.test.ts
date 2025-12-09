import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_TYPES } from "../../domain/eventType";
import type { Event } from "../../domain/types";
import { buildCheckpointKey } from "../../utils/checkpointKey";
import { EventSourcingService } from "../eventSourcingService";
import {
  cleanupTestEnvironment,
  createMockEventHandler,
  createMockEventStore,
  createMockProcessorCheckpointStore,
  createMockProjectionDefinition,
  createMockProjectionStore,
  createTestAggregateType,
  createTestContext,
  createTestEvent,
  createTestEventStoreReadContext,
  createTestProjection,
  createTestTenantId,
  setupTestEnvironment,
  TEST_CONSTANTS,
} from "./testHelpers";

describe("EventSourcingService - Projection Flows", () => {
  const { aggregateType, tenantId, context } = createTestContext();

  beforeEach(() => {
    setupTestEnvironment();
  });

  afterEach(() => {
    cleanupTestEnvironment();
  });

  describe("updateProjectionByName", () => {
    it("successfully updates projection", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      const expectedProjection = createTestProjection(
        TEST_CONSTANTS.AGGREGATE_ID,
        tenantId,
        { value: "test" },
      );
      projectionHandler.handle = vi.fn().mockResolvedValue(expectedProjection);

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
      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      projectionHandler.handle = vi
        .fn()
        .mockResolvedValue(
          createTestProjection(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
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

    it("throws when projection name not found", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
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
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
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
      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      const handlerError = new Error("Handler failed");
      projectionHandler.handle = vi.fn().mockRejectedValue(handlerError);

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
      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];
      const projection = createTestProjection(
        TEST_CONSTANTS.AGGREGATE_ID,
        tenantId,
      );

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      projectionHandler.handle = vi.fn().mockResolvedValue(projection);
      const storeError = new Error("Store failed");
      projectionStore.storeProjection = vi.fn().mockRejectedValue(storeError);

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
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
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

    it("throws when projection name not found", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
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
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
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
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
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
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
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
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
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
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
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
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
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
      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

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
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
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
      });

      await service.storeEvents(events, context);

      expect(eventStore.getEvents).toHaveBeenCalledTimes(2);
      expect(projectionHandler.handle).toHaveBeenCalledTimes(2);
    });
  });

  describe("projection checkpointing", () => {
    it("saves checkpoints after successful projection update", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const checkpointStore = createMockProcessorCheckpointStore();
      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      projectionHandler.handle = vi
        .fn()
        .mockResolvedValue(
          createTestProjection(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
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

      await service.storeEvents(events, context);

      // Checkpoint should be saved: pending (optimistic locking), then processed
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledTimes(3);
      // 1st call: pending checkpoint from idempotency checker (optimistic locking) - 5 args, no errorMessage
      expect(checkpointStore.saveCheckpoint).toHaveBeenNthCalledWith(
        1,
        tenantId,
        buildCheckpointKey(
          tenantId,
          TEST_CONSTANTS.PIPELINE_NAME,
          "projection",
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.AGGREGATE_ID,
        ),
        "projection",
        events[0],
        "pending",
        1,
      );
      // 2nd call: pending checkpoint before processing (from processProjectionEvent)
      expect(checkpointStore.saveCheckpoint).toHaveBeenNthCalledWith(
        2,
        tenantId,
        buildCheckpointKey(
          tenantId,
          TEST_CONSTANTS.PIPELINE_NAME,
          "projection",
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.AGGREGATE_ID,
        ),
        "projection",
        events[0],
        "pending",
        1,
        undefined,
      );
      // 3rd call: processed checkpoint after successful processing
      expect(checkpointStore.saveCheckpoint).toHaveBeenNthCalledWith(
        3,
        tenantId,
        buildCheckpointKey(
          tenantId,
          TEST_CONSTANTS.PIPELINE_NAME,
          "projection",
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.AGGREGATE_ID,
        ),
        "projection",
        events[0],
        "processed",
        1,
        undefined,
      );
    });

    it("saves checkpoint with failed status when projection update fails", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const checkpointStore = createMockProcessorCheckpointStore();
      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      const error = new Error("Projection update failed");
      projectionHandler.handle = vi.fn().mockRejectedValue(error);
      checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(false);

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

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();

      // Should save pending checkpoint first, then failed checkpoint
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledWith(
        tenantId,
        buildCheckpointKey(
          tenantId,
          TEST_CONSTANTS.PIPELINE_NAME,
          "projection",
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.AGGREGATE_ID,
        ),
        "projection",
        events[0],
        "pending",
        1,
        undefined,
      );
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledWith(
        tenantId,
        buildCheckpointKey(
          tenantId,
          TEST_CONSTANTS.PIPELINE_NAME,
          "projection",
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.AGGREGATE_ID,
        ),
        "projection",
        events[0],
        "failed",
        1,
        "Projection update failed",
      );
    });

    it("stops processing when a previous event failed for the same aggregate", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const checkpointStore = createMockProcessorCheckpointStore();
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

      eventStore.getEvents = vi
        .fn()
        .mockResolvedValueOnce([event1])
        .mockResolvedValueOnce([event1, event2]);

      // Make projection fail for event1
      const error = new Error("Projection failed");
      projectionHandler.handle = vi.fn().mockRejectedValueOnce(error);

      checkpointStore.hasFailedEvents = vi
        .fn()
        .mockResolvedValueOnce(false) // First check for event1 (no failures yet)
        .mockResolvedValueOnce(true); // Second check for event2 (event1 failed)

      checkpointStore.loadCheckpoint = vi.fn().mockResolvedValue(null); // No existing checkpoints

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

      // Process event1 - should fail
      await expect(
        service.storeEvents([event1], context),
      ).resolves.not.toThrow();

      // Process event2 - should be skipped due to previous failure
      await expect(
        service.storeEvents([event2], context),
      ).resolves.not.toThrow();

      // Verify projection handler was only called once (for event1)
      // Note: handler is called once for event1, and event2 is skipped due to failure check
      expect(projectionHandler.handle).toHaveBeenCalledTimes(1);
      expect(checkpointStore.hasFailedEvents).toHaveBeenCalledWith(
        TEST_CONSTANTS.PIPELINE_NAME,
        "projection",
        "projection",
        tenantId,
        aggregateType,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
    });

    it("checks for failed events before processing projection", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const checkpointStore = createMockProcessorCheckpointStore();
      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      // Simulate previous failure
      checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(true);
      checkpointStore.loadCheckpoint = vi.fn().mockResolvedValue(null);

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

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();

      // Should check for failures
      expect(checkpointStore.hasFailedEvents).toHaveBeenCalledWith(
        TEST_CONSTANTS.PIPELINE_NAME,
        "projection",
        "projection",
        tenantId,
        aggregateType,
        TEST_CONSTANTS.AGGREGATE_ID,
      );

      // Projection handler should not be called
      expect(projectionHandler.handle).not.toHaveBeenCalled();
    });
  });
});
