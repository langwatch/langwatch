import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectionUpdater } from "../projectionUpdater";
import type { Event } from "../../../domain/types";
import type { EventSourcedQueueProcessor } from "../../../queues";
import {
  createMockEventStore,
  createMockProjectionDefinition,
  createMockEventHandler,
  createMockProjectionStore,
  createMockDistributedLock,
  createMockProcessorCheckpointStore,
  createTestEvent,
  createTestTenantId,
  createTestEventStoreReadContext,
  createTestAggregateType,
  createTestProjection,
  createMockLogger,
  TEST_CONSTANTS,
} from "../../__tests__/testHelpers";
import { buildCheckpointKey } from "../../../utils/checkpointKey";
import { EventProcessorValidator } from "../../validation/eventProcessorValidator";
import { CheckpointManager } from "../../checkpoints/checkpointManager";
import { QueueProcessorManager } from "../../queues/queueProcessorManager";
import { EventUtils } from "../../../utils/event.utils";
import { EVENT_TYPES } from "../../../domain/eventType";
import { LockError, SequentialOrderingError } from "../../errorHandling";

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
    distributedLock?: any;
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
      distributedLock: options.distributedLock,
      updateLockTtlMs: 5000,
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

      const eventStore = createMockEventStore<Event>();
      eventStore.countEventsBefore = vi.fn().mockResolvedValue(0);
      eventStore.getEvents = vi
        .fn()
        .mockResolvedValue([
          createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, aggregateType, tenantId),
        ]);

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

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      await updater.processProjectionEvent(
        "projection1",
        projectionDef,
        event,
        context,
      );

      // Checkpoint is saved 3 times: pending (idempotency), pending (before processing), then processed
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledTimes(3);
      // The processed checkpoint is the 3rd call
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

      const eventStore = createMockEventStore<Event>();
      eventStore.countEventsBefore = vi.fn().mockResolvedValue(0);
      eventStore.getEvents = vi
        .fn()
        .mockResolvedValue([
          createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, aggregateType, tenantId),
        ]);

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

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

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

    it("retries lock errors without marking checkpoint as failed", async () => {
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

      const eventStore = createMockEventStore<Event>();
      eventStore.countEventsBefore = vi.fn().mockResolvedValue(0);
      eventStore.getEvents = vi
        .fn()
        .mockResolvedValue([
          createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, aggregateType, tenantId),
        ]);

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

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      const lockError = new LockError(
        "lock:test",
        "updateProjection",
        "Cannot acquire lock",
        {
          projectionName: "projection1",
        },
      );

      const updateSpy = vi
        .spyOn(updater as any, "updateProjectionByName")
        .mockRejectedValue(lockError);

      await expect(
        updater.processProjectionEvent(
          "projection1",
          projectionDef,
          event,
          context,
        ),
      ).rejects.toBe(lockError);

      const savedStatuses = vi
        .mocked(checkpointStore.saveCheckpoint)
        .mock.calls.map((call) => call[4]);

      expect(savedStatuses).not.toContain("failed");
      expect(savedStatuses.filter((status) => status === "pending").length).toBe(
        2,
      );
      expect(updateSpy).toHaveBeenCalled();
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

      const eventStore = createMockEventStore<Event>();
      eventStore.countEventsBefore = vi.fn().mockResolvedValue(0);
      eventStore.getEvents = vi
        .fn()
        .mockResolvedValue([
          createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, aggregateType, tenantId),
        ]);

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

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

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
    it("updates projection successfully with distributed lock", async () => {
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

      const distributedLock = createMockDistributedLock();
      const lockHandle = { key: "test-key", value: "test-value" };
      distributedLock.acquire = vi.fn().mockResolvedValue(lockHandle);

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
        distributedLock,
      });
      (updater as any).eventStore = eventStore;

      const result = await updater.updateProjectionByName(
        "projection1",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(distributedLock.acquire).toHaveBeenCalled();
      expect(projectionHandler.handle).toHaveBeenCalled();
      expect(projectionStore.storeProjection).toHaveBeenCalled();
      expect(distributedLock.release).toHaveBeenCalledWith(lockHandle);
      expect(result).toBeDefined();
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

    it("throws when distributed lock cannot be acquired", async () => {
      const projectionHandler = createMockEventHandler<Event, any>();
      const projections = new Map([
        [
          "projection1",
          createMockProjectionDefinition("projection1", projectionHandler),
        ],
      ]);

      const distributedLock = createMockDistributedLock();
      distributedLock.acquire = vi.fn().mockResolvedValue(null);

      const updater = createUpdater({
        projections,
        distributedLock,
      });

      await expect(
        updater.updateProjectionByName(
          "projection1",
          TEST_CONSTANTS.AGGREGATE_ID,
          context,
        ),
      ).rejects.toThrow("Cannot acquire lock for projection update");
    });
  });
});
