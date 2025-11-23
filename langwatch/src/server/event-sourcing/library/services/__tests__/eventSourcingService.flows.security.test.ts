import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventSourcingService } from "../eventSourcingService";
import type { Event } from "../../domain/types";
import {
  createMockEventStore,
  createMockEventHandlerDefinition,
  createMockEventReactionHandler,
  createMockProjectionDefinition,
  createMockEventHandler,
  createMockProcessorCheckpointStore,
  createTestEvent,
  createTestTenantId,
  createTestEventStoreReadContext,
  createTestAggregateType,
  TEST_CONSTANTS,
} from "./testHelpers";
import { buildCheckpointKey } from "../../utils/checkpointKey";
import type { AggregateType } from "../../domain/aggregateType";
import { EventStoreMemory } from "../../../runtime/stores/eventStoreMemory";
import { EventRepositoryMemory } from "../../../runtime/stores/repositories/eventRepositoryMemory";
import { ProcessorCheckpointStoreMemory } from "../../../runtime/stores/processorCheckpointStoreMemory";
import { CheckpointRepositoryMemory } from "../../../runtime/stores/repositories/checkpointRepositoryMemory";

describe("EventSourcingService - Security Flows", () => {
  const aggregateType = createTestAggregateType();
  const tenantId1 = createTestTenantId("tenant-1");
  const tenantId2 = createTestTenantId("tenant-2");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("tenant isolation", () => {
    it("tenantId is required in all contexts", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId1,
        ),
      ];

      // Context without tenantId should fail
      const invalidContext = {} as any;

      await expect(service.storeEvents(events, invalidContext)).rejects.toThrow(
        "tenantId",
      );
    });

    it("tenantId is validated before operations", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId1,
        ),
      ];

      // Empty tenantId should fail
      const invalidContext = { tenantId: "" } as any;

      await expect(service.storeEvents(events, invalidContext)).rejects.toThrow(
        "tenantId",
      );
    });

    it("events are filtered by tenantId", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
      });

      const context1 = createTestEventStoreReadContext(tenantId1);
      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId1,
        ),
      ];

      await service.storeEvents(events, context1);

      expect(eventStore.storeEvents).toHaveBeenCalledWith(
        events,
        context1,
        aggregateType,
      );
      // Verify tenantId is passed to store
      expect(eventStore.storeEvents).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ tenantId: tenantId1 }),
        aggregateType,
      );
    });

    it("projections are scoped to tenantId", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionStore = {
        getProjection: vi.fn().mockResolvedValue(null),
        storeProjection: vi.fn().mockResolvedValue(void 0),
      };
      const context1 = createTestEventStoreReadContext(tenantId1);

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

      await service.getProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context1,
      );

      expect(projectionStore.getProjection).toHaveBeenCalledWith(
        TEST_CONSTANTS.AGGREGATE_ID,
        context1,
      );
      expect(projectionStore.getProjection).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ tenantId: tenantId1 }),
      );
    });

    it("checkpoints are scoped to tenantId", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const checkpointStore = createMockProcessorCheckpointStore();
      const context1 = createTestEventStoreReadContext(tenantId1);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
        processorCheckpointStore: checkpointStore,
      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId1,
        ),
      ];
      await service.storeEvents(events, context1);

      // Checkpoint is saved with new signature: checkpointKey, processorType, event, status, sequenceNumber, errorMessage
      // Note: saveCheckpoint is called twice (pending, then processed), so we just verify it was called
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalled();
      const saveCheckpointMock = checkpointStore.saveCheckpoint as ReturnType<
        typeof vi.fn
      >;
      expect(saveCheckpointMock.mock.calls[0]?.[0]).toBe(
        buildCheckpointKey(
          tenantId1,
          TEST_CONSTANTS.PIPELINE_NAME,
          "handler",
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.AGGREGATE_ID,
        ),
      );
      expect(saveCheckpointMock.mock.calls[0]?.[1]).toBe("handler");
      expect(saveCheckpointMock.mock.calls[0]?.[2]).toMatchObject({
        tenantId: tenantId1,
        aggregateType: aggregateType,
        aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
      });
    });
  });

  describe("context validation", () => {
    it("missing tenantId causes errors", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId1,
        ),
      ];

      await expect(
        service.storeEvents(events, undefined as any),
      ).rejects.toThrow("tenantId");
    });

    it("invalid tenantId causes errors", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId1,
        ),
      ];

      const invalidContexts = [
        { tenantId: "" },
        { tenantId: "   " }, // whitespace only
        { tenantId: null },
        { tenantId: undefined },
      ];

      for (const invalidContext of invalidContexts) {
        await expect(
          service.storeEvents(events, invalidContext as any),
        ).rejects.toThrow(/tenantId|TenantId/);
      }
    });

    it("context is passed correctly to stores", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionStore = {
        getProjection: vi.fn().mockResolvedValue(null),
        storeProjection: vi.fn().mockResolvedValue(void 0),
      };
      const context = createTestEventStoreReadContext(tenantId1, {
        custom: "metadata",
      });

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

      await service.getProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(projectionStore.getProjection).toHaveBeenCalledWith(
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );
    });
  });

  describe("aggregate type scoping", () => {
    it("correct aggregateType is used for all operations", async () => {
      const eventStore = createMockEventStore<Event>();
      const customAggregateType = "trace_aggregation" as const;
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType: customAggregateType,
        eventStore,
      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId1,
        ),
      ];
      const context = createTestEventStoreReadContext(tenantId1);

      await service.storeEvents(events, context);

      expect(eventStore.storeEvents).toHaveBeenCalledWith(
        events,
        context,
        customAggregateType,
      );
    });

    it("aggregateType prevents cross-type contamination", async () => {
      const eventStore = createMockEventStore<Event>();
      const aggregateType1 = "span_ingestion" as const satisfies AggregateType;
      const aggregateType2 = "trace_aggregation" as const as AggregateType;

      const service1 = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType: aggregateType1,
        eventStore,
      });

      const service2 = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType: aggregateType2,
        eventStore,
      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId1,
        ),
      ];
      const context = createTestEventStoreReadContext(tenantId1);

      await service1.storeEvents(events, context);
      await service2.storeEvents(events, context);

      expect(eventStore.storeEvents).toHaveBeenCalledWith(
        events,
        context,
        aggregateType1,
      );
      expect(eventStore.storeEvents).toHaveBeenCalledWith(
        events,
        context,
        aggregateType2,
      );
    });
  });

  describe("security boundaries", () => {
    it("stores enforce tenant isolation", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
      });

      const context1 = createTestEventStoreReadContext(tenantId1);
      const context2 = createTestEventStoreReadContext(tenantId2);
      const events1 = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId1,
        ),
      ];
      const events2 = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId2,
        ),
      ];

      await service.storeEvents(events1, context1);
      await service.storeEvents(events2, context2);

      // Verify different tenantIds are passed to store
      expect(eventStore.storeEvents).toHaveBeenCalledWith(
        events1,
        expect.objectContaining({ tenantId: tenantId1 }),
        aggregateType,
      );
      expect(eventStore.storeEvents).toHaveBeenCalledWith(
        events2,
        expect.objectContaining({ tenantId: tenantId2 }),
        aggregateType,
      );
    });

    it("handlers receive tenant-scoped events", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const context1 = createTestEventStoreReadContext(tenantId1);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId1,
        ),
      ];
      await service.storeEvents(events, context1);

      // Handler should receive event with correct tenantId
      expect(handler.handle).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: tenantId1 }),
      );
    });

    it("projections are tenant-scoped", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionStore = {
        getProjection: vi.fn().mockResolvedValue(null),
        storeProjection: vi.fn().mockResolvedValue(void 0),
      };
      const context1 = createTestEventStoreReadContext(tenantId1);
      const context2 = createTestEventStoreReadContext(tenantId2);

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

      await service.getProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context1,
      );
      await service.getProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context2,
      );

      // Verify different tenantIds are passed to projection store
      expect(projectionStore.getProjection).toHaveBeenCalledWith(
        TEST_CONSTANTS.AGGREGATE_ID,
        expect.objectContaining({ tenantId: tenantId1 }),
      );
      expect(projectionStore.getProjection).toHaveBeenCalledWith(
        TEST_CONSTANTS.AGGREGATE_ID,
        expect.objectContaining({ tenantId: tenantId2 }),
      );
    });

    it("events from different tenants are isolated", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const context1 = createTestEventStoreReadContext(tenantId1);
      const context2 = createTestEventStoreReadContext(tenantId2);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
      });

      const events1 = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId1,
        ),
      ];
      const events2 = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId2,
        ),
      ];

      await service.storeEvents(events1, context1);
      await service.storeEvents(events2, context2);

      // Verify events are stored with correct tenant contexts
      expect(eventStore.storeEvents).toHaveBeenNthCalledWith(
        1,
        events1,
        context1,
        aggregateType,
      );
      expect(eventStore.storeEvents).toHaveBeenNthCalledWith(
        2,
        events2,
        context2,
        aggregateType,
      );
    });
  });

  describe("security edge cases for recovery operations", () => {
    it("getFailedEvents enforces tenant isolation", async () => {
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

      const tenantId1 = createTestTenantId("tenant-1");
      const tenantId2 = createTestTenantId("tenant-2");
      const context1 = createTestEventStoreReadContext(tenantId1);
      const context2 = createTestEventStoreReadContext(tenantId2);

      const event1 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId1,
      );
      const event2 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId2,
      );

      // Make handler fail for both events
      handler.handle = vi.fn().mockRejectedValue(new Error("Handler failed"));

      // Process events for both tenants
      await service.storeEvents([event1], context1);
      await service.storeEvents([event2], context2);

      // Get failed events for tenant1 - should only return tenant1's events
      const failedEvents1 = await checkpointStore.getFailedEvents(
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        "handler",
        tenantId1,
        aggregateType,
        TEST_CONSTANTS.AGGREGATE_ID,
      );

      // Get failed events for tenant2 - should only return tenant2's events
      const failedEvents2 = await checkpointStore.getFailedEvents(
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        "handler",
        tenantId2,
        aggregateType,
        TEST_CONSTANTS.AGGREGATE_ID,
      );

      // Verify tenant isolation
      expect(failedEvents1).toHaveLength(1);
      expect(failedEvents1[0]?.tenantId).toBe(tenantId1);
      expect(failedEvents2).toHaveLength(1);
      expect(failedEvents2[0]?.tenantId).toBe(tenantId2);
    });

    it("clearCheckpoint enforces tenant isolation", async () => {
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

      const tenantId1 = createTestTenantId("tenant-1");
      const tenantId2 = createTestTenantId("tenant-2");
      const context1 = createTestEventStoreReadContext(tenantId1);
      const context2 = createTestEventStoreReadContext(tenantId2);

      const event1 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId1,
      );
      const event2 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId2,
      );

      // Make handler fail for both events
      handler.handle = vi.fn().mockRejectedValue(new Error("Handler failed"));

      // Process events for both tenants
      await service.storeEvents([event1], context1);
      await service.storeEvents([event2], context2);

      // Clear checkpoint for tenant1's event (using new per-aggregate key format)
      const checkpointKey1ToClear = buildCheckpointKey(
        tenantId1,
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      await checkpointStore.clearCheckpoint(checkpointKey1ToClear);

      // Verify tenant1's checkpoint is cleared
      const checkpointKey1 = buildCheckpointKey(
        tenantId1,
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      const checkpoint1 = await checkpointStore.loadCheckpoint(checkpointKey1);
      expect(checkpoint1).toBeNull();

      // Verify tenant2's checkpoint still exists
      const checkpointKey2 = buildCheckpointKey(
        tenantId2,
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
      const checkpoint2 = await checkpointStore.loadCheckpoint(checkpointKey2);
      expect(checkpoint2).not.toBeNull();
      expect(checkpoint2?.tenantId).toBe(tenantId2);
    });

    it("recovery operations validate tenant context", async () => {
      const eventStore = createMockEventStore<Event>();
      const checkpointStore = new ProcessorCheckpointStoreMemory(
        new CheckpointRepositoryMemory(),
      );

      // Try to get failed events with invalid tenant context
      await expect(
        checkpointStore.getFailedEvents(
          TEST_CONSTANTS.PIPELINE_NAME,
          "handler",
          "handler",
          "" as any, // Invalid tenant ID
          aggregateType,
          TEST_CONSTANTS.AGGREGATE_ID,
        ),
      ).rejects.toThrow("tenantId");
    });

    it("cross-tenant access attempts in recovery are prevented", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const checkpointStore = createMockProcessorCheckpointStore();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
        processorCheckpointStore: checkpointStore,
      });

      const tenantId1 = createTestTenantId("tenant-1");
      const tenantId2 = createTestTenantId("tenant-2");
      const context1 = createTestEventStoreReadContext(tenantId1);

      const event1 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId1,
      );

      // Make handler fail
      handler.handle = vi.fn().mockRejectedValue(new Error("Handler failed"));

      // Process event for tenant1
      await service.storeEvents([event1], context1);

      // Try to get failed events for tenant2 (should return empty, not tenant1's events)
      const failedEvents2 = await checkpointStore.getFailedEvents(
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        "handler",
        tenantId2,
        aggregateType,
        TEST_CONSTANTS.AGGREGATE_ID,
      );

      // Should be empty (tenant isolation)
      expect(failedEvents2).toHaveLength(0);
    });

    it("input validation for malformed events in recovery workflows", async () => {
      const eventStore = new EventStoreMemory<Event>(
        new EventRepositoryMemory(),
      );
      const handler = createMockEventReactionHandler<Event>();
      const checkpointStore = createMockProcessorCheckpointStore();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
        processorCheckpointStore: checkpointStore,
      });

      const context = createTestEventStoreReadContext(tenantId1);

      // Try to store malformed event
      const malformedEvent = {
        id: "event-1",
        // Missing required fields
      } as any;

      await expect(
        service.storeEvents([malformedEvent], context),
      ).rejects.toThrow();
    });
  });
});
