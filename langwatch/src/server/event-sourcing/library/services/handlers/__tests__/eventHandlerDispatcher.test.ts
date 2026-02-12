import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_TYPES } from "../../../domain/eventType";
import type { Event } from "../../../domain/types";
import type { EventSourcedQueueProcessor } from "../../../queues";
import {
  createMockEventHandlerDefinition,
  createMockEventReactionHandler,
  createTestAggregateType,
  createTestEvent,
  createTestEventStoreReadContext,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../__tests__/testHelpers";
import { QueueProcessorManager } from "../../queues/queueProcessorManager";
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
    queueManager?: QueueProcessorManager<Event>;
  }): EventHandlerDispatcher<Event> {
    const queueManager =
      options.queueManager ??
      new QueueProcessorManager({
        aggregateType,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
      });

    return new EventHandlerDispatcher({
      aggregateType,
      eventHandlers: options.eventHandlers,
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
        waitUntilReady: vi.fn().mockResolvedValue(void 0),
      };

      const queueManager = new QueueProcessorManager({
        aggregateType,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
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

      const dispatcher = createDispatcher({
        eventHandlers,
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

      const dispatcher = createDispatcher({
        eventHandlers,
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

    it("skips dispatch to disabled handlers (queue mode)", async () => {
      const enabledHandler = createMockEventReactionHandler<Event>();
      const disabledHandler = createMockEventReactionHandler<Event>();
      const eventHandlers = new Map([
        [
          "enabledHandler",
          createMockEventHandlerDefinition("enabledHandler", enabledHandler),
        ],
        [
          "disabledHandler",
          createMockEventHandlerDefinition("disabledHandler", disabledHandler, {
            disabled: true,
          }),
        ],
      ]);

      const enabledQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
        waitUntilReady: vi.fn().mockResolvedValue(void 0),
      };
      const disabledQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
        waitUntilReady: vi.fn().mockResolvedValue(void 0),
      };

      const queueManager = new QueueProcessorManager({
        aggregateType,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
      });
      (queueManager as any).handlerQueueProcessors.set(
        "enabledHandler",
        enabledQueueProcessor,
      );
      (queueManager as any).handlerQueueProcessors.set(
        "disabledHandler",
        disabledQueueProcessor,
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

      expect(enabledQueueProcessor.send).toHaveBeenCalledWith(event);
      expect(disabledQueueProcessor.send).not.toHaveBeenCalled();
    });

    it("skips dispatch to disabled handlers (sync mode)", async () => {
      const enabledHandler = createMockEventReactionHandler<Event>();
      const disabledHandler = createMockEventReactionHandler<Event>();
      const eventHandlers = new Map([
        [
          "enabledHandler",
          createMockEventHandlerDefinition("enabledHandler", enabledHandler),
        ],
        [
          "disabledHandler",
          createMockEventHandlerDefinition("disabledHandler", disabledHandler, {
            disabled: true,
          }),
        ],
      ]);

      const dispatcher = createDispatcher({
        eventHandlers,
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      await dispatcher.dispatchEventsToHandlers([event], context);

      expect(enabledHandler.handle).toHaveBeenCalledWith(event);
      expect(disabledHandler.handle).not.toHaveBeenCalled();
    });
  });

  describe("handleEvent", () => {
    it("calls handler.handle with the event", async () => {
      const handler = createMockEventReactionHandler<Event>();
      const handlerDef = createMockEventHandlerDefinition("handler1", handler);

      const dispatcher = createDispatcher({});

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      await dispatcher.handleEvent("handler1", handlerDef, event, context);

      expect(handler.handle).toHaveBeenCalledWith(event);
    });

    it("propagates handler errors", async () => {
      const handler = createMockEventReactionHandler<Event>();
      handler.handle = vi.fn().mockRejectedValue(new Error("Handler error"));
      const handlerDef = createMockEventHandlerDefinition("handler1", handler);

      const dispatcher = createDispatcher({});

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      await expect(
        dispatcher.handleEvent("handler1", handlerDef, event, context),
      ).rejects.toThrow("Handler error");
    });
  });
});
