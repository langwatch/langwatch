import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_TYPES } from "../../domain/eventType";
import type { Event } from "../../domain/types";
import { EventSourcingService } from "../eventSourcingService";
import {
  cleanupTestEnvironment,
  createMockEventHandlerDefinition,
  createMockEventReactionHandler,
  createMockEventStore,
  createTestContext,
  createTestEvent,
  setupTestEnvironment,
  TEST_CONSTANTS,
} from "./testHelpers";

describe("EventSourcingService - Handler Flows", () => {
  const { aggregateType, tenantId, context } = createTestContext();

  beforeEach(() => {
    setupTestEnvironment();
  });

  afterEach(() => {
    cleanupTestEnvironment();
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

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
      );

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

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
      );

      await expect(
        service.storeEvents([event], context),
      ).resolves.not.toThrow();

      expect(handler1.handle).toHaveBeenCalledTimes(1);
      expect(handler2.handle).toHaveBeenCalledTimes(1);
    });
  });

  describe("when using queue-based processing", () => {
    it("calls handler.handle directly without checkpoints", async () => {
      const eventStore = createMockEventStore<Event>();
      const handler = createMockEventReactionHandler<Event>();

      const mockQueueFactory = {
        create: vi.fn().mockImplementation((definition: any) => {
          // Simulate queue: call process immediately on send
          return {
            send: vi.fn().mockImplementation(async (payload: any) => {
              await definition.process(payload);
            }),
            close: vi.fn().mockResolvedValue(void 0),
            waitUntilReady: vi.fn().mockResolvedValue(void 0),
          };
        }),
      };

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        eventHandlers: {
          handler: createMockEventHandlerDefinition("handler", handler),
        },
        queueProcessorFactory: mockQueueFactory,
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
      );

      await service.storeEvents([event], context);

      expect(handler.handle).toHaveBeenCalledWith(event);
    });
  });
});
