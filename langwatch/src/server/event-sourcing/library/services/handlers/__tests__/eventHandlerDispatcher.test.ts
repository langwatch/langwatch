import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_TYPES } from "../../../domain/eventType";
import type { Event } from "../../../domain/types";
import type { EventSourcedQueueProcessor } from "../../../queues";
import { buildCheckpointKey } from "../../../utils/checkpointKey";
import {
  createMockEventHandlerDefinition,
  createMockEventReactionHandler,
  createMockEventStore,
  createMockLogger,
  createMockProcessorCheckpointStore,
  createTestAggregateType,
  createTestEvent,
  createTestEventStoreReadContext,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../__tests__/testHelpers";
import { CheckpointManager } from "../../checkpoints/checkpointManager";
import { SequentialOrderingError } from "../../errorHandling";
import { QueueProcessorManager } from "../../queues/queueProcessorManager";
import { EventProcessorValidator } from "../../validation/eventProcessorValidator";
import { EventHandlerDispatcher } from "../eventHandlerDispatcher";

describe("EventHandlerDispatcher", () => {
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

  function createDispatcher(options: {
    eventHandlers?: Map<string, any>;
    processorCheckpointStore?: any;
    queueManager?: QueueProcessorManager<Event>;
    validator?: EventProcessorValidator<Event>;
    checkpointManager?: CheckpointManager<Event>;
  }): EventHandlerDispatcher<Event> {
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

    return new EventHandlerDispatcher({
      aggregateType,
      eventHandlers: options.eventHandlers,
      processorCheckpointStore: options.processorCheckpointStore,
      validator,
      checkpointManager,
      queueManager,
    });
  }

  describe("dispatchEventsToHandlers", () => {
    it("does nothing when no handlers registered", async () => {
      const dispatcher = createDispatcher({});

      await dispatcher.dispatchEventsToHandlers([], context);

      // Should complete without error
      expect(true).toBe(true);
    });

    it("dispatches to queues when queue processors available", async () => {
      const handler = createMockEventReactionHandler<Event>();
      const eventHandlers = new Map([
        ["handler1", createMockEventHandlerDefinition("handler1", handler)],
      ]);

      const mockQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
      };

      const queueManager = new QueueProcessorManager({
        aggregateType,
      });
      // Manually add queue processor to simulate initialization
      (queueManager as any).handlerQueueProcessors.set(
        "handler1",
        mockQueueProcessor,
      );

      const dispatcher = createDispatcher({
        eventHandlers,
        queueManager,
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      await dispatcher.dispatchEventsToHandlers([event], context);

      expect(mockQueueProcessor.send).toHaveBeenCalledWith(event);
    });

    it("dispatches synchronously when no queue processors", async () => {
      const handler = createMockEventReactionHandler<Event>();
      const eventHandlers = new Map([
        ["handler1", createMockEventHandlerDefinition("handler1", handler)],
      ]);

      const checkpointStore = createMockProcessorCheckpointStore();
      checkpointStore.loadCheckpoint = vi.fn().mockResolvedValue(null);
      checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(false);
      checkpointStore.getCheckpointBySequenceNumber = vi
        .fn()
        .mockResolvedValue(null);

      const dispatcher = createDispatcher({
        eventHandlers,
        processorCheckpointStore: checkpointStore,
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      await dispatcher.dispatchEventsToHandlers([event], context);

      expect(handler.handle).toHaveBeenCalledWith(event);
    });

    it("filters events by event type", async () => {
      const handler = createMockEventReactionHandler<Event>();
      const eventHandlers = new Map([
        [
          "handler1",
          createMockEventHandlerDefinition("handler1", handler, {
            eventTypes: [EVENT_TYPES[0]],
          }),
        ],
      ]);

      const checkpointStore = createMockProcessorCheckpointStore();
      checkpointStore.loadCheckpoint = vi.fn().mockResolvedValue(null);
      checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(false);
      checkpointStore.getCheckpointBySequenceNumber = vi
        .fn()
        .mockResolvedValue(null);

      const dispatcher = createDispatcher({
        eventHandlers,
        processorCheckpointStore: checkpointStore,
      });

      const event1 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
        EVENT_TYPES[0],
      );
      const event2 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
        EVENT_TYPES[1] ?? EVENT_TYPES[0],
      );

      await dispatcher.dispatchEventsToHandlers([event1, event2], context);

      // Handler should only receive event1 (matching eventTypes)
      expect(handler.handle).toHaveBeenCalledTimes(1);
      expect(handler.handle).toHaveBeenCalledWith(event1);
    });

    it("skips dispatch when previous events have failed (queue mode)", async () => {
      const handler = createMockEventReactionHandler<Event>();
      const eventHandlers = new Map([
        ["handler1", createMockEventHandlerDefinition("handler1", handler)],
      ]);

      const mockQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
      };

      const queueManager = new QueueProcessorManager({
        aggregateType,
      });
      (queueManager as any).handlerQueueProcessors.set(
        "handler1",
        mockQueueProcessor,
      );

      const checkpointStore = createMockProcessorCheckpointStore();
      checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(true);

      createMockLogger();
      const dispatcher = createDispatcher({
        eventHandlers,
        processorCheckpointStore: checkpointStore,
        queueManager,
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      await dispatcher.dispatchEventsToHandlers([event], context);

      expect(mockQueueProcessor.send).not.toHaveBeenCalled();
      // EventHandlerDispatcher uses its own logger, so we can't verify the exact log call
      // But we can verify that dispatch was skipped (queue processor wasn't called)
    });
  });

  describe("handleEvent", () => {
    it("processes event and saves checkpoints", async () => {
      const handler = createMockEventReactionHandler<Event>();
      const handlerDef = createMockEventHandlerDefinition("handler1", handler);

      const checkpointStore = createMockProcessorCheckpointStore();
      checkpointStore.loadCheckpoint = vi.fn().mockResolvedValue(null);
      checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(false);
      checkpointStore.getCheckpointBySequenceNumber = vi
        .fn()
        .mockResolvedValue(null);

      const dispatcher = createDispatcher({
        processorCheckpointStore: checkpointStore,
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      await dispatcher.handleEvent("handler1", handlerDef, event, context);

      expect(handler.handle).toHaveBeenCalledWith(event);
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledTimes(3); // pending (optimistic locking), then processed
      // 1st call: pending checkpoint from idempotency checker (optimistic locking) - 5 args, no errorMessage
      expect(checkpointStore.saveCheckpoint).toHaveBeenNthCalledWith(
        1,
        tenantId,
        buildCheckpointKey(
          tenantId,
          TEST_CONSTANTS.PIPELINE_NAME,
          "handler1",
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.AGGREGATE_ID,
        ),
        "handler",
        event,
        "pending",
        1,
      );
      // 2nd call: pending checkpoint before processing (from handleEvent)
      expect(checkpointStore.saveCheckpoint).toHaveBeenNthCalledWith(
        2,
        tenantId,
        buildCheckpointKey(
          tenantId,
          TEST_CONSTANTS.PIPELINE_NAME,
          "handler1",
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.AGGREGATE_ID,
        ),
        "handler",
        event,
        "pending",
        1,
        void 0,
      );
      // 3rd call: processed checkpoint after successful processing
      expect(checkpointStore.saveCheckpoint).toHaveBeenNthCalledWith(
        3,
        tenantId,
        buildCheckpointKey(
          tenantId,
          TEST_CONSTANTS.PIPELINE_NAME,
          "handler1",
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.AGGREGATE_ID,
        ),
        "handler",
        event,
        "processed",
        1,
        void 0,
      );
    });

    it("saves failed checkpoint when handler throws", async () => {
      const handler = createMockEventReactionHandler<Event>();
      handler.handle = vi.fn().mockRejectedValue(new Error("Handler error"));
      const handlerDef = createMockEventHandlerDefinition("handler1", handler);

      const checkpointStore = createMockProcessorCheckpointStore();
      checkpointStore.loadCheckpoint = vi.fn().mockResolvedValue(null);
      checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(false);
      checkpointStore.getCheckpointBySequenceNumber = vi
        .fn()
        .mockResolvedValue(null);

      createMockLogger();
      const dispatcher = createDispatcher({
        processorCheckpointStore: checkpointStore,
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      await expect(
        dispatcher.handleEvent("handler1", handlerDef, event, context),
      ).rejects.toThrow("Handler error");

      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledTimes(3); // pending (idempotency), pending (validation), then failed
      // The failed checkpoint is the 3rd call (after 2 pending checkpoints)
      expect(checkpointStore.saveCheckpoint).toHaveBeenNthCalledWith(
        3,
        tenantId,
        buildCheckpointKey(
          tenantId,
          TEST_CONSTANTS.PIPELINE_NAME,
          "handler1",
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.AGGREGATE_ID,
        ),
        "handler",
        event,
        "failed",
        1,
        "Handler error",
      );
      // EventHandlerDispatcher uses its own logger, so we can't verify the exact log call here
      // But we can verify the error was handled (checkpoint was saved as failed)
    });

    it("skips processing when event already processed", async () => {
      const handler = createMockEventReactionHandler<Event>();
      const handlerDef = createMockEventHandlerDefinition("handler1", handler);

      const checkpointStore = createMockProcessorCheckpointStore();
      checkpointStore.loadCheckpoint = vi.fn().mockResolvedValue({
        status: "processed",
        sequenceNumber: 1,
      });

      const dispatcher = createDispatcher({
        processorCheckpointStore: checkpointStore,
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      await dispatcher.handleEvent("handler1", handlerDef, event, context);

      expect(handler.handle).not.toHaveBeenCalled();
      expect(checkpointStore.saveCheckpoint).not.toHaveBeenCalled();
    });

    it("skips processing when previous events have failed", async () => {
      const handler = createMockEventReactionHandler<Event>();
      const handlerDef = createMockEventHandlerDefinition("handler1", handler);

      const checkpointStore = createMockProcessorCheckpointStore();
      checkpointStore.loadCheckpoint = vi.fn().mockResolvedValue(null);
      checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(true);

      const dispatcher = createDispatcher({
        processorCheckpointStore: checkpointStore,
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      await dispatcher.handleEvent("handler1", handlerDef, event, context);

      expect(handler.handle).not.toHaveBeenCalled();
      // Optimistic locking still saves a pending checkpoint during validation
      // even when processing is skipped due to previous failures
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledTimes(1);
    });

    it("throws SequentialOrderingError when previous event has pending checkpoint", async () => {
      const handler = createMockEventReactionHandler<Event>();
      const handlerDef = createMockEventHandlerDefinition("handler1", handler);

      const checkpointStore = createMockProcessorCheckpointStore();
      checkpointStore.loadCheckpoint = vi.fn().mockResolvedValue(null);
      checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(false);
      // Mock getCheckpointBySequenceNumber to return a pending checkpoint for sequence 1
      checkpointStore.getCheckpointBySequenceNumber = vi
        .fn()
        .mockImplementation(
          (
            pipelineName,
            processorName,
            processorType,
            tenantId,
            aggregateType,
            aggregateId,
            sequenceNumber,
          ) => {
            // For sequence 1, return a pending checkpoint
            if (sequenceNumber === 1) {
              return Promise.resolve({
                processorName: "handler1",
                processorType: "handler",
                tenantId,
                aggregateType,
                aggregateId,
                sequenceNumber: 1,
                status: "pending",
                eventId: "event1",
                timestamp: TEST_CONSTANTS.BASE_TIMESTAMP,
              });
            }
            return Promise.resolve(null);
          },
        );

      const dispatcher = createDispatcher({
        processorCheckpointStore: checkpointStore,
      });

      // Create event2 (sequence 2) - should fail because event1 (sequence 1) is still pending
      const event2 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
        EVENT_TYPES[0],
        2000000,
        {},
        "event2",
      );

      const validator = (dispatcher as any).validator;
      validator.computeEventSequenceNumber = vi.fn().mockResolvedValue(2);

      await expect(
        dispatcher.handleEvent("handler1", handlerDef, event2, context),
      ).rejects.toThrow(SequentialOrderingError);

      expect(handler.handle).not.toHaveBeenCalled();
      // Should not save any checkpoints since ordering check fails early
      expect(checkpointStore.saveCheckpoint).not.toHaveBeenCalled();
    });

    it("does not mark checkpoint as failed for ordering errors", async () => {
      const handler = createMockEventReactionHandler<Event>();
      const handlerDef = createMockEventHandlerDefinition("handler1", handler);

      const checkpointStore = createMockProcessorCheckpointStore();
      checkpointStore.loadCheckpoint = vi.fn().mockResolvedValue(null);
      checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(false);
      checkpointStore.getCheckpointBySequenceNumber = vi
        .fn()
        .mockResolvedValue({ status: "processed", sequenceNumber: 1 });

      const checkpointManager = new CheckpointManager(
        TEST_CONSTANTS.PIPELINE_NAME,
        checkpointStore,
      );
      const checkpointSpy = vi.spyOn(checkpointManager, "saveCheckpointSafely");

      const dispatcher = createDispatcher({
        processorCheckpointStore: checkpointStore,
        checkpointManager,
      });

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
        { handlerName: "handler1" },
      );

      const validator = (dispatcher as any).validator;
      validator.computeEventSequenceNumber = vi.fn().mockResolvedValue(2);
      validator.validateEventProcessing = vi
        .fn()
        .mockRejectedValue(orderingError);

      await expect(
        dispatcher.handleEvent("handler1", handlerDef, event, context),
      ).rejects.toBe(orderingError);

      const failedCalls = checkpointSpy.mock.calls.filter(
        (call) => call[3] === "failed",
      );
      expect(failedCalls).toHaveLength(0);
    });
  });
});
