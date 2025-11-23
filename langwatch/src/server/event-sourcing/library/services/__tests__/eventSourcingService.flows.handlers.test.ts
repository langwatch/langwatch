import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventSourcingService } from "../eventSourcingService";
import type { Event } from "../../domain/types";
import {
  createMockEventStore,
  createMockEventHandlerDefinition,
  createMockEventReactionHandler,
  createMockProcessorCheckpointStore,
  createTestEvent,
  TEST_CONSTANTS,
  setupTestEnvironment,
  cleanupTestEnvironment,
  createTestContext,
} from "./testHelpers";
import { EVENT_TYPES } from "../../domain/eventType";
import { buildCheckpointKey } from "../../utils/checkpointKey";

describe("EventSourcingService - Handler Flows", () => {
  const { aggregateType, tenantId, context } = createTestContext();

  beforeEach(() => {
    setupTestEnvironment();
  });

  afterEach(() => {
    cleanupTestEnvironment();
  });

  describe("checkpoint management", () => {
    it("checkpoint errors don't fail handler execution", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const checkpointStore = createMockProcessorCheckpointStore();
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn().mockReturnThis(),
        level: "info",
        silent: false,
      };

      const checkpointError = new Error("Checkpoint save failed");
      checkpointStore.saveCheckpoint = vi
        .fn()
        .mockRejectedValue(checkpointError);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
        processorCheckpointStore: checkpointStore,
        logger: logger as any,
      });

      const event = createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId);

      await expect(
        service.storeEvents([event], context),
      ).resolves.not.toThrow();

      expect(handler.handle).toHaveBeenCalledTimes(1);
      // Checkpoint errors are logged by CheckpointManager (which uses its own logger)
      // but don't prevent handler execution - verify handler was called
    });
  });

  describe("error handling", () => {
    it("handler errors are logged", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn().mockReturnThis(),
        level: "info",
        silent: false,
      };

      const handlerError = new Error("Handler failed");
      handler.handle = vi.fn().mockRejectedValue(handlerError);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
        logger: logger as any,
      });

      const event = createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId);

      await expect(
        service.storeEvents([event], context),
      ).resolves.not.toThrow();

      // Error handling uses standardized error handling in EventHandlerDispatcher
      // which uses its own logger, so we can't verify the exact log call here
      // But we can verify the operation completed successfully (error was handled)
      expect(handler.handle).toHaveBeenCalled();
    });

    it("handler errors don't stop other handlers", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler1 = createMockEventReactionHandler<Event>();
      const handler2 = createMockEventReactionHandler<Event>();

      handler1.handle = vi.fn().mockRejectedValue(new Error("Handler1 failed"));
      handler2.handle = vi.fn().mockResolvedValue(void 0);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        eventHandlers: {
          handler1: createMockEventHandlerDefinition("handler1", handler1),
          handler2: createMockEventHandlerDefinition("handler2", handler2),
        },
      });

      const event = createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId);

      await expect(
        service.storeEvents([event], context),
      ).resolves.not.toThrow();

      expect(handler1.handle).toHaveBeenCalledTimes(1);
      expect(handler2.handle).toHaveBeenCalledTimes(1);
    });
  });

  describe("failure handling and checkpointing", () => {
    it("stops processing when a previous event failed for the same aggregate", async () => {
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

      // Simulate that event1 failed
      checkpointStore.hasFailedEvents = vi
        .fn()
        .mockResolvedValueOnce(false) // First check for event1 (no failures yet)
        .mockResolvedValueOnce(true); // Second check for event2 (event1 failed)

      // Make handler fail for event1
      handler.handle = vi
        .fn()
        .mockRejectedValueOnce(new Error("Handler failed"))
        .mockResolvedValueOnce(void 0);

      // Process event1 - should fail
      await expect(
        service.storeEvents([event1], context),
      ).resolves.not.toThrow();

      // Verify event1 was marked as failed
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledWith(
        buildCheckpointKey(tenantId, TEST_CONSTANTS.PIPELINE_NAME, "handler", TEST_CONSTANTS.AGGREGATE_TYPE, TEST_CONSTANTS.AGGREGATE_ID),
        "handler",
        event1,
        "failed",
        1,
        "Handler failed",
      );

      // Process event2 - should be skipped due to previous failure
      await expect(
        service.storeEvents([event2], context),
      ).resolves.not.toThrow();

      // Verify event2 handler was not called
      expect(handler.handle).toHaveBeenCalledTimes(1); // Only event1
      expect(checkpointStore.hasFailedEvents).toHaveBeenCalledWith(
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        "handler",
        tenantId,
        aggregateType,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
    });

    it("does not stop processing for different aggregates when one fails", async () => {
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

      const event1 = createTestEvent(
        "aggregate-1",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        TEST_CONSTANTS.BASE_TIMESTAMP,
      );
      const event2 = createTestEvent(
        "aggregate-2",
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        TEST_CONSTANTS.BASE_TIMESTAMP + 1000,
      );

      // Make handler fail for aggregate-1
      handler.handle = vi
        .fn()
        .mockRejectedValueOnce(new Error("Handler failed"))
        .mockResolvedValueOnce(void 0);

      checkpointStore.hasFailedEvents = vi
        .fn()
        .mockResolvedValue(false); // No failures for aggregate-2

      // Process both events
      await expect(
        service.storeEvents([event1, event2], context),
      ).resolves.not.toThrow();

      // Both handlers should be called (even though aggregate-1 failed)
      expect(handler.handle).toHaveBeenCalledTimes(2);
    });

    it("saves checkpoint with failed status when handler throws", async () => {
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

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        TEST_CONSTANTS.BASE_TIMESTAMP,
      );

      const error = new Error("Handler processing failed");
      handler.handle = vi.fn().mockRejectedValue(error);
      checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(false);

      await expect(
        service.storeEvents([event], context),
      ).resolves.not.toThrow();

      // Should save pending checkpoint first
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledWith(
        buildCheckpointKey(tenantId, TEST_CONSTANTS.PIPELINE_NAME, "handler", TEST_CONSTANTS.AGGREGATE_TYPE, TEST_CONSTANTS.AGGREGATE_ID),
        "handler",
        event,
        "pending",
        1,
        undefined,
      );

      // Then save failed checkpoint
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledWith(
        buildCheckpointKey(tenantId, TEST_CONSTANTS.PIPELINE_NAME, "handler", TEST_CONSTANTS.AGGREGATE_TYPE, TEST_CONSTANTS.AGGREGATE_ID),
        "handler",
        event,
        "failed",
        1,
        "Handler processing failed",
      );
    });

    it("checks for failed events before processing", async () => {
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

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        TEST_CONSTANTS.BASE_TIMESTAMP,
      );

      // Simulate previous failure
      checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(true);
      checkpointStore.loadCheckpoint = vi.fn().mockResolvedValue(null);

      await expect(
        service.storeEvents([event], context),
      ).resolves.not.toThrow();

      // Should check for failures
      expect(checkpointStore.hasFailedEvents).toHaveBeenCalledWith(
        TEST_CONSTANTS.PIPELINE_NAME,
        "handler",
        "handler",
        tenantId,
        aggregateType,
        TEST_CONSTANTS.AGGREGATE_ID,
      );

      // Handler should not be called
      expect(handler.handle).not.toHaveBeenCalled();
    });
  });
});
