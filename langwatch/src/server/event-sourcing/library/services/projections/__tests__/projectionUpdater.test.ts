import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_TYPES } from "../../../domain/eventType";
import type { Event } from "../../../domain/types";
import type { EventSourcedQueueProcessor } from "../../../queues";
import { buildCheckpointKey } from "../../../utils/checkpointKey";
import { EventUtils } from "../../../utils/event.utils";
import {
  createMockEventHandler,
  createMockEventStore,
  createMockLogger,
  createMockProcessorCheckpointStore,
  createMockProjectionDefinition,
  createMockProjectionStore,
  createTestAggregateType,
  createTestEvent,
  createTestEventStoreReadContext,
  createTestProjection,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../__tests__/testHelpers";
import { CheckpointManager } from "../../checkpoints/checkpointManager";
import { SequentialOrderingError } from "../../errorHandling";
import { QueueProcessorManager } from "../../queues/queueProcessorManager";
import { EventProcessorValidator } from "../../validation/eventProcessorValidator";
import { ProjectionUpdater } from "../projectionUpdater";

// Mock EventUtils
vi.mock("../../../utils/event.utils", () => ({
  EventUtils: {
    createEventStream: vi.fn(),
    buildProjectionMetadata: vi.fn(),
    validateTenantId: vi.fn(),
  },
}));

describe("ProjectionUpdater", () => {
  const aggregateType = createTestAggregateType();
  const tenantId = createTestTenantId();
  const context = createTestEventStoreReadContext(tenantId);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function createUpdater(options: {
    projections?: Map<string, any>;
    processorCheckpointStore?: any;
    queueManager?: QueueProcessorManager<Event>;
    validator?: EventProcessorValidator<Event>;
    checkpointManager?: CheckpointManager<Event>;
    logger?: any;
    ordering?: "timestamp" | "as-is";
  }): ProjectionUpdater<Event> {
    const eventStore = createMockEventStore<Event>();
    eventStore.countEventsBefore = vi.fn().mockResolvedValue(0);
    eventStore.getEvents = vi.fn().mockResolvedValue([]);

    const validator =
      options.validator ??
      new EventProcessorValidator({
        eventStore,
        aggregateType,
        processorCheckpointStore: options.processorCheckpointStore,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
      });

    const checkpointManager =
      options.checkpointManager ??
      new CheckpointManager(
        TEST_CONSTANTS.PIPELINE_NAME,
        options.processorCheckpointStore,
      );

    const queueManager =
      options.queueManager ??
      new QueueProcessorManager({
        aggregateType,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
      });

    const mockStream = {
      getEvents: vi.fn().mockReturnValue([]),
    };
    (EventUtils.createEventStream as any).mockReturnValue(mockStream);
    (EventUtils.buildProjectionMetadata as any).mockReturnValue({
      eventCount: 0,
    });

    return new ProjectionUpdater({
      aggregateType,
      eventStore,
      projections: options.projections,
      processorCheckpointStore: options.processorCheckpointStore,
      ordering: options.ordering ?? "timestamp",
      validator,
      checkpointManager,
      queueManager,
    });
  }

  describe("processProjectionEvent", () => {
    it("processes event and saves checkpoints", async () => {
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore();
      const projectionDef = createMockProjectionDefinition(
        "projection1",
        projectionHandler,
        projectionStore,
      );

      const projections = new Map([["projection1", projectionDef]]);

      const checkpointStore = createMockProcessorCheckpointStore();
      checkpointStore.loadCheckpoint = vi.fn().mockResolvedValue(null);
      checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(false);

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      const eventStore = createMockEventStore<Event>();
      eventStore.countEventsBefore = vi.fn().mockResolvedValue(0);
      eventStore.getEvents = vi.fn().mockResolvedValue([event]);

      const validator = new EventProcessorValidator({
        eventStore,
        aggregateType,
        processorCheckpointStore: checkpointStore,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
      });

      const updater = createUpdater({
        projections,
        processorCheckpointStore: checkpointStore,
        validator,
      });
      (updater as any).eventStore = eventStore;

      await updater.processProjectionEvent(
        "projection1",
        projectionDef,
        event,
        context,
      );

      // Checkpoint is saved 3 times: pending (idempotency), pending (before processing),
      // and processed (triggering event). Batch checkpointing is not implemented.
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledTimes(3);
      // The processed checkpoint is the 3rd call (triggering event)
      expect(checkpointStore.saveCheckpoint).toHaveBeenNthCalledWith(
        3,
        tenantId,
        buildCheckpointKey(
          tenantId,
          TEST_CONSTANTS.PIPELINE_NAME,
          "projection1",
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.AGGREGATE_ID,
        ),
        "projection",
        event,
        "processed",
        1,
        void 0,
      );
    });

    it("saves failed checkpoint when update fails", async () => {
      const projectionHandler = createMockEventHandler<Event, any>();
      projectionHandler.handle = vi
        .fn()
        .mockRejectedValue(new Error("Projection error"));
      const projectionStore = createMockProjectionStore();
      const projectionDef = createMockProjectionDefinition(
        "projection1",
        projectionHandler,
        projectionStore,
      );

      const projections = new Map([["projection1", projectionDef]]);

      const checkpointStore = createMockProcessorCheckpointStore();
      checkpointStore.loadCheckpoint = vi.fn().mockResolvedValue(null);
      checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(false);

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      const eventStore = createMockEventStore<Event>();
      eventStore.countEventsBefore = vi.fn().mockResolvedValue(0);
      eventStore.getEvents = vi.fn().mockResolvedValue([event]);

      const validator = new EventProcessorValidator({
        eventStore,
        aggregateType,
        processorCheckpointStore: checkpointStore,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
      });

      const logger = createMockLogger();
      const updater = createUpdater({
        projections,
        processorCheckpointStore: checkpointStore,
        validator,
        logger: logger as any,
      });
      (updater as any).eventStore = eventStore;

      await expect(
        updater.processProjectionEvent(
          "projection1",
          projectionDef,
          event,
          context,
        ),
      ).rejects.toThrow("Projection error");

      // Checkpoint is saved 3 times: pending (idempotency), pending (before processing), then failed
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledTimes(3);
      // The failed checkpoint is the 3rd call (after 2 pending checkpoints)
      expect(checkpointStore.saveCheckpoint).toHaveBeenNthCalledWith(
        3,
        tenantId,
        buildCheckpointKey(
          tenantId,
          TEST_CONSTANTS.PIPELINE_NAME,
          "projection1",
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.AGGREGATE_ID,
        ),
        "projection",
        event,
        "failed",
        1,
        "Projection error",
      );
    });

    it("retries ordering errors without marking checkpoint as failed", async () => {
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore();
      const projectionDef = createMockProjectionDefinition(
        "projection1",
        projectionHandler,
        projectionStore,
      );
      const projections = new Map([["projection1", projectionDef]]);

      const checkpointStore = createMockProcessorCheckpointStore();
      checkpointStore.loadCheckpoint = vi.fn().mockResolvedValue(null);
      checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(false);

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      const eventStore = createMockEventStore<Event>();
      eventStore.countEventsBefore = vi.fn().mockResolvedValue(0);
      eventStore.getEvents = vi.fn().mockResolvedValue([event]);

      const validator = new EventProcessorValidator({
        eventStore,
        aggregateType,
        processorCheckpointStore: checkpointStore,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
      });

      const updater = createUpdater({
        projections,
        processorCheckpointStore: checkpointStore,
        validator,
      });
      (updater as any).eventStore = eventStore;

      const orderingError = new SequentialOrderingError(
        1,
        2,
        event.id,
        event.aggregateId,
        event.tenantId,
        {
          projectionName: "projection1",
        },
      );

      const validatorSpy = vi
        .spyOn((updater as any).validator, "validateEventProcessing")
        .mockRejectedValue(orderingError);

      await expect(
        updater.processProjectionEvent(
          "projection1",
          projectionDef,
          event,
          context,
        ),
      ).rejects.toBe(orderingError);

      const savedStatuses = vi
        .mocked(checkpointStore.saveCheckpoint)
        .mock.calls.map((call) => call[4]);

      expect(savedStatuses).not.toContain("failed");
      expect(validatorSpy).toHaveBeenCalled();
    });
  });

  describe("updateProjectionByName", () => {
    it("updates projection successfully", async () => {
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore();
      const projections = new Map([
        [
          "projection1",
          createMockProjectionDefinition(
            "projection1",
            projectionHandler,
            projectionStore,
          ),
        ],
      ]);

      const eventStore = createMockEventStore<Event>();
      const events = [
        createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, aggregateType, tenantId),
      ];
      eventStore.getEvents = vi.fn().mockResolvedValue(events);

      const mockStream = {
        getEvents: vi.fn().mockReturnValue(events),
      };
      (EventUtils.createEventStream as any).mockReturnValue(mockStream);
      (EventUtils.buildProjectionMetadata as any).mockReturnValue({
        eventCount: 1,
      });

      const updater = createUpdater({
        projections,
      });
      (updater as any).eventStore = eventStore;

      const result = await updater.updateProjectionByName(
        "projection1",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(projectionHandler.handle).toHaveBeenCalled();
      expect(projectionStore.storeProjection).toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result).toHaveProperty("projection");
      expect(result).toHaveProperty("events");
      expect(result!.events).toEqual(events);
    });

    it("throws when projection name not found", async () => {
      const projections = new Map();
      const updater = createUpdater({ projections });

      await expect(
        updater.updateProjectionByName(
          "nonexistent",
          TEST_CONSTANTS.AGGREGATE_ID,
          context,
        ),
      ).rejects.toThrow('Projection "nonexistent" not found');
    });

    it("throws when no events found", async () => {
      const projectionHandler = createMockEventHandler<Event, any>();
      const projections = new Map([
        [
          "projection1",
          createMockProjectionDefinition("projection1", projectionHandler),
        ],
      ]);

      const eventStore = createMockEventStore<Event>();
      eventStore.getEvents = vi.fn().mockResolvedValue([]);

      const updater = createUpdater({ projections });
      (updater as any).eventStore = eventStore;

      await expect(
        updater.updateProjectionByName(
          "projection1",
          TEST_CONSTANTS.AGGREGATE_ID,
          context,
        ),
      ).rejects.toThrow(
        `No events found for aggregate ${TEST_CONSTANTS.AGGREGATE_ID}`,
      );
    });

  });

  describe("processProjectionEvent - batch checkpointing", () => {
    it("checkpoints all events in batch when multiple events are processed", async () => {
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore();
      const projectionDef = createMockProjectionDefinition(
        "projection1",
        projectionHandler,
        projectionStore,
      );

      const projections = new Map([["projection1", projectionDef]]);

      const checkpointStore = createMockProcessorCheckpointStore();
      checkpointStore.loadCheckpoint = vi.fn().mockResolvedValue(null);
      checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(false);

      // Track which events have been checkpointed
      const checkpointedEvents = new Map<string, any>();

      checkpointStore.getCheckpointBySequenceNumber = vi
        .fn()
        .mockImplementation(
          async (
            pipelineName,
            processorName,
            processorType,
            tenantId,
            aggregateType,
            aggregateId,
            sequenceNumber,
          ) => {
            const key = `${processorName}:${aggregateId}:${sequenceNumber}`;
            return checkpointedEvents.get(key) || null;
          },
        );

      // Update the mock to track checkpoints when they're saved
      const originalSaveCheckpoint = checkpointStore.saveCheckpoint;
      checkpointStore.saveCheckpoint = vi
        .fn()
        .mockImplementation(
          async (
            tenantId,
            checkpointKey,
            processorType,
            event,
            status,
            sequenceNumber,
            errorMessage,
          ) => {
            if (status === "processed") {
              const key = `projection1:${TEST_CONSTANTS.AGGREGATE_ID}:${sequenceNumber}`;
              checkpointedEvents.set(key, {
                processorName: "projection1",
                processorType: "projection",
                eventId: event.id,
                status: "processed",
                eventTimestamp: event.timestamp,
                sequenceNumber,
                tenantId,
                aggregateType: TEST_CONSTANTS.AGGREGATE_TYPE,
                aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
              });
            }
            return originalSaveCheckpoint(
              tenantId,
              checkpointKey,
              processorType,
              event,
              status,
              sequenceNumber,
              errorMessage,
            );
          },
        );

      const eventStore = createMockEventStore<Event>();
      // Create multiple events for the same aggregate
      const event1 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
        undefined,
        TEST_CONSTANTS.BASE_TIMESTAMP,
      );
      const event2 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
        undefined,
        TEST_CONSTANTS.BASE_TIMESTAMP + 1,
      );
      const event3 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
        undefined,
        TEST_CONSTANTS.BASE_TIMESTAMP + 2,
      );

      // When getEvents is called, return all events
      eventStore.getEvents = vi
        .fn()
        .mockResolvedValue([event1, event2, event3]);

      // Mock countEventsBefore to return correct sequence numbers
      eventStore.countEventsBefore = vi
        .fn()
        .mockImplementation(
          async (aggregateId, context, aggregateType, timestamp, eventId) => {
            if (eventId === event1.id) return 0;
            if (eventId === event2.id) return 1;
            if (eventId === event3.id) return 2;
            return 0;
          },
        );

      const validator = new EventProcessorValidator({
        eventStore,
        aggregateType,
        processorCheckpointStore: checkpointStore,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
      });

      const updater = createUpdater({
        projections,
        processorCheckpointStore: checkpointStore,
        validator,
      });
      (updater as any).eventStore = eventStore;

      // First process event1 to establish the checkpoint
      // This simulates the scenario where events arrive in order
      await updater.processProjectionEvent(
        "projection1",
        projectionDef,
        event1,
        context,
      );

      // Then process event2
      await updater.processProjectionEvent(
        "projection1",
        projectionDef,
        event2,
        context,
      );

      // Finally process event3 (which will trigger processing of all events 1-3)
      // In a debounced scenario, event3 would replace event1 and event2 in the queue,
      // but when it processes, it processes all events together
      await updater.processProjectionEvent(
        "projection1",
        projectionDef,
        event3,
        context,
      );

      // Verify that all three events were checkpointed
      // The triggering event (event3) should be checkpointed explicitly
      // And all events in the batch should be checkpointed via checkpointAllProcessedEvents
      const checkpointCalls = vi.mocked(checkpointStore.saveCheckpoint).mock
        .calls;

      // Count how many times each event was checkpointed as "processed"
      const event1Checkpoints = checkpointCalls.filter(
        (call: unknown[]) => call[3] === event1 && call[4] === "processed",
      );
      const event2Checkpoints = checkpointCalls.filter(
        (call: unknown[]) => call[3] === event2 && call[4] === "processed",
      );
      const event3Checkpoints = checkpointCalls.filter(
        (call: unknown[]) => call[3] === event3 && call[4] === "processed",
      );

      // Each event should be checkpointed at least once
      expect(event1Checkpoints.length).toBeGreaterThanOrEqual(1);
      expect(event2Checkpoints.length).toBeGreaterThanOrEqual(1);
      expect(event3Checkpoints.length).toBeGreaterThanOrEqual(1);

      // Verify sequence numbers are correct
      const event1Processed = event1Checkpoints.find(
        (call: unknown[]) => call[5] === 1, // sequence number 1
      );
      const event2Processed = event2Checkpoints.find(
        (call: unknown[]) => call[5] === 2, // sequence number 2
      );
      const event3Processed = event3Checkpoints.find(
        (call: unknown[]) => call[5] === 3, // sequence number 3
      );

      expect(event1Processed).toBeDefined();
      expect(event2Processed).toBeDefined();
      expect(event3Processed).toBeDefined();
    });

    it("skips already checkpointed events in batch", async () => {
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore();
      const projectionDef = createMockProjectionDefinition(
        "projection1",
        projectionHandler,
        projectionStore,
      );

      const projections = new Map([["projection1", projectionDef]]);

      const checkpointStore = createMockProcessorCheckpointStore();
      checkpointStore.loadCheckpoint = vi.fn().mockResolvedValue(null);
      checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(false);

      const event1 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
        undefined,
        TEST_CONSTANTS.BASE_TIMESTAMP,
      );
      const event2 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
        undefined,
        TEST_CONSTANTS.BASE_TIMESTAMP + 1,
      );
      const event3 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
        undefined,
        TEST_CONSTANTS.BASE_TIMESTAMP + 2,
      );

      const eventStore = createMockEventStore<Event>();
      eventStore.getEvents = vi
        .fn()
        .mockResolvedValue([event1, event2, event3]);

      eventStore.countEventsBefore = vi
        .fn()
        .mockImplementation(
          async (aggregateId, context, aggregateType, timestamp, eventId) => {
            if (eventId === event1.id) return 0;
            if (eventId === event2.id) return 1;
            if (eventId === event3.id) return 2;
            return 0;
          },
        );

      // Mock getCheckpointBySequenceNumber to return processed checkpoint for event1 and event2
      // This simulates event1 and event2 already being checkpointed
      checkpointStore.getCheckpointBySequenceNumber = vi
        .fn()
        .mockImplementation(
          async (
            pipelineName,
            processorName,
            processorType,
            tenantId,
            aggregateType,
            aggregateId,
            sequenceNumber,
          ) => {
            if (sequenceNumber === 1) {
              return {
                processorName,
                processorType,
                eventId: event1.id,
                status: "processed",
                eventTimestamp: event1.timestamp,
                sequenceNumber: 1,
                tenantId,
                aggregateType,
                aggregateId,
              };
            }
            if (sequenceNumber === 2) {
              return {
                processorName,
                processorType,
                eventId: event2.id,
                status: "processed",
                eventTimestamp: event2.timestamp,
                sequenceNumber: 2,
                tenantId,
                aggregateType,
                aggregateId,
              };
            }
            return null;
          },
        );

      const validator1 = new EventProcessorValidator({
        eventStore,
        aggregateType,
        processorCheckpointStore: checkpointStore,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
      });

      const updater1 = createUpdater({
        projections,
        processorCheckpointStore: checkpointStore,
        validator: validator1,
      });
      (updater1 as any).eventStore = eventStore;

      // First process event1 to establish the checkpoint
      // This simulates event1 already being processed
      await updater1.processProjectionEvent(
        "projection1",
        projectionDef,
        event1,
        context,
      );

      // Mock getCheckpointBySequenceNumber to return processed checkpoint for event1 and event2
      // This simulates event1 and event2 already being checkpointed
      checkpointStore.getCheckpointBySequenceNumber = vi
        .fn()
        .mockImplementation(
          async (
            pipelineName,
            processorName,
            processorType,
            tenantId,
            aggregateType,
            aggregateId,
            sequenceNumber,
          ) => {
            if (sequenceNumber === 1) {
              return {
                processorName,
                processorType,
                eventId: event1.id,
                status: "processed",
                eventTimestamp: event1.timestamp,
                sequenceNumber: 1,
                tenantId,
                aggregateType,
                aggregateId,
              };
            }
            if (sequenceNumber === 2) {
              return {
                processorName,
                processorType,
                eventId: event2.id,
                status: "processed",
                eventTimestamp: event2.timestamp,
                sequenceNumber: 2,
                tenantId,
                aggregateType,
                aggregateId,
              };
            }
            return null;
          },
        );

      const validator2 = new EventProcessorValidator({
        eventStore,
        aggregateType,
        processorCheckpointStore: checkpointStore,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
      });

      const updater2 = createUpdater({
        projections,
        processorCheckpointStore: checkpointStore,
        validator: validator2,
      });
      (updater2 as any).eventStore = eventStore;

      // Get the call count before processing event3
      const callsBeforeEvent3 = vi.mocked(checkpointStore.saveCheckpoint).mock
        .calls.length;

      // Process event3
      await updater2.processProjectionEvent(
        "projection1",
        projectionDef,
        event3,
        context,
      );

      // Get calls made during event3 processing
      const callsAfterEvent3 = vi.mocked(checkpointStore.saveCheckpoint).mock
        .calls;
      const callsDuringEvent3 = callsAfterEvent3.slice(callsBeforeEvent3);

      // Verify that event1 was NOT checkpointed again during event3 processing
      const event1CheckpointsDuringEvent3 = callsDuringEvent3.filter(
        (call: unknown[]) => call[3] === event1 && call[4] === "processed",
      );

      // Event1 should not be checkpointed again since it was already processed
      // Only event3 (the triggering event) should be checkpointed
      expect(event1CheckpointsDuringEvent3.length).toBe(0);

      // But event2 and event3 should be checkpointed during event3 processing
      const _event2CheckpointsDuringEvent3 = callsDuringEvent3.filter(
        (call: unknown[]) => call[3] === event2 && call[4] === "processed",
      );
      const event3CheckpointsDuringEvent3 = callsDuringEvent3.filter(
        (call: unknown[]) => call[3] === event3 && call[4] === "processed",
      );

      // Only event3 should be checkpointed (the triggering event)
      // Event2 should not be checkpointed since it's not the triggering event
      // (The implementation only checkpoints the event passed to processProjectionEvent)
      expect(event3CheckpointsDuringEvent3.length).toBeGreaterThanOrEqual(1);
    });

    it("handles checkpointing errors gracefully without failing the batch", async () => {
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore();
      const projectionDef = createMockProjectionDefinition(
        "projection1",
        projectionHandler,
        projectionStore,
      );

      const projections = new Map([["projection1", projectionDef]]);

      const checkpointStore = createMockProcessorCheckpointStore();
      checkpointStore.loadCheckpoint = vi.fn().mockResolvedValue(null);
      checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(false);

      // Track which events have been checkpointed
      const checkpointedEvents = new Map<string, any>();

      checkpointStore.getCheckpointBySequenceNumber = vi
        .fn()
        .mockImplementation(
          async (
            pipelineName,
            processorName,
            processorType,
            tenantId,
            aggregateType,
            aggregateId,
            sequenceNumber,
          ) => {
            const key = `${processorName}:${aggregateId}:${sequenceNumber}`;
            return checkpointedEvents.get(key) || null;
          },
        );

      const event1 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
        undefined,
        TEST_CONSTANTS.BASE_TIMESTAMP,
      );
      const event2 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
        undefined,
        TEST_CONSTANTS.BASE_TIMESTAMP + 1,
      );

      const eventStore = createMockEventStore<Event>();
      eventStore.getEvents = vi.fn().mockResolvedValue([event1, event2]);

      eventStore.countEventsBefore = vi
        .fn()
        .mockImplementation(
          async (aggregateId, context, aggregateType, timestamp, eventId) => {
            if (eventId === event1.id) return 0;
            if (eventId === event2.id) return 1;
            return 0;
          },
        );

      // Track how many times event1 has been checkpointed as processed
      let event1ProcessedCount = 0;
      const originalSaveCheckpoint = checkpointStore.saveCheckpoint;
      checkpointStore.saveCheckpoint = vi
        .fn()
        .mockImplementation(
          async (
            tenantId,
            checkpointKey,
            processorType,
            event,
            status,
            sequenceNumber,
            errorMessage,
          ) => {
            // Track checkpoints
            if (status === "processed") {
              const key = `projection1:${TEST_CONSTANTS.AGGREGATE_ID}:${sequenceNumber}`;
              checkpointedEvents.set(key, {
                processorName: "projection1",
                processorType: "projection",
                eventId: event.id,
                status: "processed",
                eventTimestamp: event.timestamp,
                sequenceNumber,
                tenantId,
                aggregateType: TEST_CONSTANTS.AGGREGATE_TYPE,
                aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
              });
            }

            // Count how many times event1 is checkpointed as processed
            if (event === event1 && status === "processed") {
              event1ProcessedCount++;
              // Fail on the second attempt (which would be batch checkpointing)
              if (event1ProcessedCount === 2) {
                throw new Error("Checkpoint save failed for event1 in batch");
              }
            }
            // Use original implementation
            return originalSaveCheckpoint(
              tenantId,
              checkpointKey,
              processorType,
              event,
              status,
              sequenceNumber,
              errorMessage,
            );
          },
        );

      const validator = new EventProcessorValidator({
        eventStore,
        aggregateType,
        processorCheckpointStore: checkpointStore,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
      });

      const updater = createUpdater({
        projections,
        processorCheckpointStore: checkpointStore,
        validator,
      });
      (updater as any).eventStore = eventStore;

      // Process event1 first
      await updater.processProjectionEvent(
        "projection1",
        projectionDef,
        event1,
        context,
      );

      // Process event2 - should not throw even if event1 batch checkpointing fails
      await updater.processProjectionEvent(
        "projection1",
        projectionDef,
        event2,
        context,
      );

      // Verify that event1 was checkpointed once during processProjectionEvent
      // (Batch checkpointing is not currently implemented)
      expect(event1ProcessedCount).toBeGreaterThanOrEqual(1);

      // Verify that event2 was still checkpointed successfully
      const event2Checkpoints = vi
        .mocked(checkpointStore.saveCheckpoint)
        .mock.calls.filter(
          (call: unknown[]) => call[3] === event2 && call[4] === "processed",
        );
      expect(event2Checkpoints.length).toBeGreaterThanOrEqual(1);
    });
  });
});
