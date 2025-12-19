import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Command, CommandHandler } from "../../../commands/command";
import type { CommandHandlerClass } from "../../../commands/commandHandlerClass";
import { defineCommandSchema } from "../../../commands/commandSchema";
import type { CommandType } from "../../../domain/commandType";
import { EVENT_TYPES } from "../../../domain/eventType";
import type { Event } from "../../../domain/types";
import type { EventSourcedQueueProcessor } from "../../../queues";
import {
  createMockEventHandler,
  createMockEventHandlerDefinition,
  createMockEventReactionHandler,
  createMockProjectionDefinition,
  createTestAggregateType,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../__tests__/testHelpers";
import { QueueProcessorManager } from "../queueProcessorManager";

/**
 * Creates a mock command handler class for testing.
 */
function createMockCommandHandlerClass(
  name: string,
): CommandHandlerClass<any, CommandType, Event> {
  const payloadSchema = z.object({
    tenantId: z.string(),
    aggregateId: z.string(),
    data: z.string().optional(),
  });

  class MockCommandHandler implements CommandHandler<Command<any, any>, Event> {
    static readonly schema = defineCommandSchema(
      `test.command.${name}` as CommandType,
      payloadSchema,
    );

    static getAggregateId(payload: any): string {
      return payload.aggregateId;
    }

    async handle(_command: Command<any, any>): Promise<Event[]> {
      return [];
    }
  }

  return MockCommandHandler as any;
}

describe("QueueProcessorManager", () => {
  const aggregateType = createTestAggregateType();
  const tenantId = createTestTenantId();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("createDefaultJobId", () => {
    it("creates job ID in correct format", () => {
      const manager = new QueueProcessorManager({
        aggregateType,
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
        EVENT_TYPES[0],
        TEST_CONSTANTS.BASE_TIMESTAMP,
      );

      const jobId = manager.createDefaultJobId(event);

      expect(jobId).toBe(
        `${TEST_CONSTANTS.BASE_TIMESTAMP}:${tenantId}:${TEST_CONSTANTS.AGGREGATE_ID}:${aggregateType}:0`,
      );
    });
  });

  describe("initializeHandlerQueues", () => {
    it("does nothing when queue factory is not provided", () => {
      const manager = new QueueProcessorManager({
        aggregateType,
      });

      const handlers = {
        handler1: createMockEventHandlerDefinition("handler1"),
      };
      const handleEventCallback = vi.fn();

      manager.initializeHandlerQueues(handlers, handleEventCallback);

      expect(manager.getHandlerQueueProcessors().size).toBe(0);
    });

    it("initializes queue processors for all handlers", () => {
      const mockQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
      };

      const queueFactory = {
        create: vi.fn().mockReturnValue(mockQueueProcessor),
      };

      const manager = new QueueProcessorManager({
        aggregateType,
        queueProcessorFactory: queueFactory as any,
      });

      const handlers = {
        handler1: createMockEventHandlerDefinition("handler1"),
        handler2: createMockEventHandlerDefinition("handler2"),
      };
      const handleEventCallback = vi.fn();

      manager.initializeHandlerQueues(handlers, handleEventCallback);

      expect(queueFactory.create).toHaveBeenCalledTimes(2);
      expect(manager.getHandlerQueueProcessors().size).toBe(2);
      expect(manager.getHandlerQueueProcessor("handler1")).toBe(
        mockQueueProcessor,
      );
      expect(manager.getHandlerQueueProcessor("handler2")).toBe(
        mockQueueProcessor,
      );
    });

    it("uses handler's makeJobId when provided", () => {
      const customJobId = vi.fn().mockReturnValue("custom-job-id");
      const mockQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
      };

      const queueFactory = {
        create: vi.fn().mockReturnValue(mockQueueProcessor),
      };

      const manager = new QueueProcessorManager({
        aggregateType,
        queueProcessorFactory: queueFactory as any,
      });

      const handlers = {
        handler1: createMockEventHandlerDefinition("handler1", void 0, {
          makeJobId: customJobId,
        }),
      };
      const handleEventCallback = vi.fn();

      manager.initializeHandlerQueues(handlers, handleEventCallback);

      expect(queueFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          makeJobId: customJobId,
        }),
      );
    });

    it("uses default job ID when handler's makeJobId not provided", () => {
      const mockQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
      };

      const queueFactory = {
        create: vi.fn().mockReturnValue(mockQueueProcessor),
      };

      const manager = new QueueProcessorManager({
        aggregateType,
        queueProcessorFactory: queueFactory as any,
      });

      const handlers = {
        handler1: createMockEventHandlerDefinition("handler1"),
      };
      const handleEventCallback = vi.fn();

      manager.initializeHandlerQueues(handlers, handleEventCallback);

      const createCall = queueFactory.create.mock.calls[0]?.[0];
      expect(createCall?.makeJobId).toBeDefined();
      expect(typeof createCall?.makeJobId).toBe("function");
    });

    it("passes handler options (delay, concurrency) to queue factory", () => {
      const mockQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
      };

      const queueFactory = {
        create: vi.fn().mockReturnValue(mockQueueProcessor),
      };

      const manager = new QueueProcessorManager({
        aggregateType,
        queueProcessorFactory: queueFactory as any,
      });

      const handlers = {
        handler1: createMockEventHandlerDefinition("handler1", void 0, {
          delay: 1000,
          concurrency: 5,
        }),
      };
      const handleEventCallback = vi.fn();

      manager.initializeHandlerQueues(handlers, handleEventCallback);

      expect(queueFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          delay: 1000,
          options: { concurrency: 5 },
        }),
      );
    });
  });

  describe("initializeProjectionQueues", () => {
    it("does nothing when queue factory is not provided", () => {
      const manager = new QueueProcessorManager({
        aggregateType,
      });

      const projections = {
        projection1: createMockProjectionDefinition("projection1"),
      };
      const processProjectionEventCallback = vi.fn();

      manager.initializeProjectionQueues(
        projections,
        processProjectionEventCallback,
      );

      expect(manager.getProjectionQueueProcessors().size).toBe(0);
    });

    it("initializes queue processors for all projections", () => {
      const mockQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
      };

      const queueFactory = {
        create: vi.fn().mockReturnValue(mockQueueProcessor),
      };

      const manager = new QueueProcessorManager({
        aggregateType,
        queueProcessorFactory: queueFactory as any,
      });

      const projections = {
        projection1: createMockProjectionDefinition("projection1"),
        projection2: createMockProjectionDefinition("projection2"),
      };
      const processProjectionEventCallback = vi.fn();

      manager.initializeProjectionQueues(
        projections,
        processProjectionEventCallback,
      );

      expect(queueFactory.create).toHaveBeenCalledTimes(2);
      expect(manager.getProjectionQueueProcessors().size).toBe(2);
      expect(manager.getProjectionQueueProcessor("projection1")).toBe(
        mockQueueProcessor,
      );
      expect(manager.getProjectionQueueProcessor("projection2")).toBe(
        mockQueueProcessor,
      );
    });

    it("uses event ID as job ID for projections", () => {
      const mockQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
      };

      const queueFactory = {
        create: vi.fn().mockReturnValue(mockQueueProcessor),
      };

      const manager = new QueueProcessorManager({
        aggregateType,
        queueProcessorFactory: queueFactory as any,
      });

      const projections = {
        projection1: createMockProjectionDefinition("projection1"),
      };
      const processProjectionEventCallback = vi.fn();

      manager.initializeProjectionQueues(
        projections,
        processProjectionEventCallback,
      );

      const createCall = queueFactory.create.mock.calls[0]?.[0];
      expect(createCall?.makeJobId).toBeDefined();

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );
      const jobId = createCall?.makeJobId?.(event);
      expect(jobId).toBe(event.id);
    });

    it("uses custom makeJobId function when provided", () => {
      const mockQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
      };

      const queueFactory = {
        create: vi.fn().mockReturnValue(mockQueueProcessor),
      };

      const manager = new QueueProcessorManager({
        aggregateType,
        queueProcessorFactory: queueFactory as any,
      });

      const customMakeJobId = vi.fn((event: Event) => `custom-${event.aggregateId}`);

      const projections = {
        projection1: createMockProjectionDefinition("projection1", undefined, {
          makeJobId: customMakeJobId,
        }),
      };
      const processProjectionEventCallback = vi.fn();

      manager.initializeProjectionQueues(
        projections,
        processProjectionEventCallback,
      );

      const createCall = queueFactory.create.mock.calls[0]?.[0];
      expect(createCall?.makeJobId).toBe(customMakeJobId);

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );
      const jobId = createCall?.makeJobId?.(event);
      expect(jobId).toBe(`custom-${TEST_CONSTANTS.AGGREGATE_ID}`);
      expect(customMakeJobId).toHaveBeenCalledWith(event);
    });

    it("falls back to event ID when makeJobId is not provided", () => {
      const mockQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
      };

      const queueFactory = {
        create: vi.fn().mockReturnValue(mockQueueProcessor),
      };

      const manager = new QueueProcessorManager({
        aggregateType,
        queueProcessorFactory: queueFactory as any,
      });

      const projections = {
        projection1: createMockProjectionDefinition("projection1", undefined, {}),
      };
      const processProjectionEventCallback = vi.fn();

      manager.initializeProjectionQueues(
        projections,
        processProjectionEventCallback,
      );

      const createCall = queueFactory.create.mock.calls[0]?.[0];
      expect(createCall?.makeJobId).toBeDefined();

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );
      const jobId = createCall?.makeJobId?.(event);
      expect(jobId).toBe(event.id);
    });
  });

  describe("initializeCommandQueues", () => {
    it("does nothing when queue factory is not provided", () => {
      const manager = new QueueProcessorManager({
        aggregateType,
      });

      const commandRegistrations = [
        {
          name: "command1",
          HandlerClass: createMockCommandHandlerClass("command1"),
        },
      ];
      const storeEventsFn = vi.fn();

      manager.initializeCommandQueues(
        commandRegistrations,
        storeEventsFn,
        "test-pipeline",
      );

      expect(manager.getCommandQueueProcessors().size).toBe(0);
    });

    it("initializes queue processors for all command handlers", () => {
      const mockQueueProcessor: EventSourcedQueueProcessor<any> = {
        send: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
      };

      const queueFactory = {
        create: vi.fn().mockReturnValue(mockQueueProcessor),
      };

      const manager = new QueueProcessorManager({
        aggregateType,
        queueProcessorFactory: queueFactory as any,
      });

      const commandRegistrations = [
        {
          name: "command1",
          HandlerClass: createMockCommandHandlerClass("command1"),
        },
        {
          name: "command2",
          HandlerClass: createMockCommandHandlerClass("command2"),
        },
      ];
      const storeEventsFn = vi.fn();

      manager.initializeCommandQueues(
        commandRegistrations,
        storeEventsFn,
        "test-pipeline",
      );

      expect(queueFactory.create).toHaveBeenCalledTimes(2);
      expect(manager.getCommandQueueProcessors().size).toBe(2);
      // The manager wraps the processor with validation, so we check the interface exists
      const command1Processor = manager.getCommandQueueProcessor("command1");
      const command2Processor = manager.getCommandQueueProcessor("command2");
      expect(command1Processor).toBeDefined();
      expect(command2Processor).toBeDefined();
      expect(typeof command1Processor?.send).toBe("function");
      expect(typeof command1Processor?.close).toBe("function");
      expect(typeof command2Processor?.send).toBe("function");
      expect(typeof command2Processor?.close).toBe("function");
    });

    it("throws error when command name already exists", () => {
      const mockQueueProcessor: EventSourcedQueueProcessor<any> = {
        send: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
      };

      const queueFactory = {
        create: vi.fn().mockReturnValue(mockQueueProcessor),
      };

      const manager = new QueueProcessorManager({
        aggregateType,
        queueProcessorFactory: queueFactory as any,
      });

      const commandRegistrations = [
        {
          name: "command1",
          HandlerClass: createMockCommandHandlerClass("command1"),
        },
      ];
      const storeEventsFn = vi.fn();

      manager.initializeCommandQueues(
        commandRegistrations,
        storeEventsFn,
        "test-pipeline",
      );

      // Try to initialize again with same name
      expect(() => {
        manager.initializeCommandQueues(
          commandRegistrations,
          storeEventsFn,
          "test-pipeline",
        );
      }).toThrow(
        'Command handler with name "command1" already exists. Command handler names must be unique within a pipeline.',
      );
    });
  });

  describe("close", () => {
    it("closes all handler, projection, and command queue processors", async () => {
      const handlerQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
      };
      const projectionQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
      };
      const commandQueueProcessor: EventSourcedQueueProcessor<any> = {
        send: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
      };

      const queueFactory = {
        create: vi
          .fn()
          .mockReturnValueOnce(handlerQueueProcessor)
          .mockReturnValueOnce(projectionQueueProcessor)
          .mockReturnValueOnce(commandQueueProcessor),
      };

      const manager = new QueueProcessorManager({
        aggregateType,
        queueProcessorFactory: queueFactory as any,
      });

      const handlers = {
        handler1: createMockEventHandlerDefinition("handler1"),
      };
      const handleEventCallback = vi.fn();
      manager.initializeHandlerQueues(handlers, handleEventCallback);

      const projections = {
        projection1: createMockProjectionDefinition("projection1"),
      };
      const processProjectionEventCallback = vi.fn();
      manager.initializeProjectionQueues(
        projections,
        processProjectionEventCallback,
      );

      const commandRegistrations = [
        {
          name: "command1",
          HandlerClass: createMockCommandHandlerClass("command1"),
        },
      ];
      const storeEventsFn = vi.fn();
      manager.initializeCommandQueues(
        commandRegistrations,
        storeEventsFn,
        "test-pipeline",
      );

      await manager.close();

      expect(handlerQueueProcessor.close).toHaveBeenCalledTimes(1);
      expect(projectionQueueProcessor.close).toHaveBeenCalledTimes(1);
      expect(commandQueueProcessor.close).toHaveBeenCalledTimes(1);
    });

    it("handles close errors gracefully", async () => {
      const handlerQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockRejectedValue(new Error("Close failed")),
      };

      const queueFactory = {
        create: vi.fn().mockReturnValue(handlerQueueProcessor),
      };

      const manager = new QueueProcessorManager({
        aggregateType,
        queueProcessorFactory: queueFactory as any,
      });

      const handlers = {
        handler1: createMockEventHandlerDefinition("handler1"),
      };
      const handleEventCallback = vi.fn();
      manager.initializeHandlerQueues(handlers, handleEventCallback);

      // Should not throw
      await manager.close();

      expect(handlerQueueProcessor.close).toHaveBeenCalledTimes(1);
    });
  });
});
