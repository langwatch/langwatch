import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Command, CommandHandler } from "../../../commands/command";
import type { CommandHandlerClass } from "../../../commands/commandHandlerClass";
import { defineCommandSchema } from "../../../commands/commandSchema";
import type { CommandType } from "../../../domain/commandType";
import { EVENT_TYPES } from "../../../domain/eventType";
import type { Event } from "../../../domain/types";
import type { DeduplicationStrategy } from "../../../queues";
import type { EventSourcedQueueProcessor } from "../../../queues";
import {
  createTestAggregateType,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../__tests__/testHelpers";
import { QueueManager } from "../queueManager";

/**
 * Creates a mock event handler definition in the shape expected by QueueManager.initializeHandlerQueues.
 */
function createMockEventHandlerDefinition(
  name: string,
  handler?: { handle: (event: Event) => Promise<void> },
  options?: {
    eventTypes?: readonly string[];
    delay?: number;
    deduplication?: DeduplicationStrategy<Event>;
    concurrency?: number;
    spanAttributes?: (event: Event) => Record<string, string | number | boolean>;
    disabled?: boolean;
  },
) {
  return {
    name,
    handler: handler ?? { handle: vi.fn().mockResolvedValue(void 0) },
    options: {
      eventTypes: EVENT_TYPES,
      ...options,
    },
  };
}

/**
 * Creates a mock projection definition in the shape expected by QueueManager.initializeProjectionQueues.
 */
function createMockProjectionDefinition(
  name: string,
  options?: {
    groupKeyFn?: (event: Event) => string;
    killSwitch?: { customKey?: string };
  },
) {
  return {
    name,
    groupKeyFn: options?.groupKeyFn,
    options: options?.killSwitch ? { killSwitch: options.killSwitch } : undefined,
  };
}

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

describe("QueueManager", () => {
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

  // Note: createDefaultDeduplicationId is now a private method.
  // The deduplication ID format is tested through the queue initialization tests.

  describe("initializeHandlerQueues", () => {
    it("does nothing when queue factory is not provided", () => {
      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
      });

      const handlers = {
        handler1: createMockEventHandlerDefinition("handler1"),
      };
      const handleEventCallback = vi.fn();

      manager.initializeHandlerQueues(handlers, handleEventCallback);

      expect(manager.hasHandlerQueues()).toBe(false);
    });

    it("initializes queue processors for all handlers", () => {
      const mockQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        sendBatch: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
        waitUntilReady: vi.fn().mockResolvedValue(void 0),
      };

      const queueFactory = {
        create: vi.fn().mockReturnValue(mockQueueProcessor),
      };

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        queueFactory: queueFactory as any,
      });

      const handlers = {
        handler1: createMockEventHandlerDefinition("handler1"),
        handler2: createMockEventHandlerDefinition("handler2"),
      };
      const handleEventCallback = vi.fn();

      manager.initializeHandlerQueues(handlers, handleEventCallback);

      expect(queueFactory.create).toHaveBeenCalledTimes(2);
      expect(manager.getHandlerQueue("handler1")).toBe(
        mockQueueProcessor,
      );
      expect(manager.getHandlerQueue("handler2")).toBe(
        mockQueueProcessor,
      );
    });

    it("uses handler's deduplication config when provided", () => {
      const customDeduplicationId = vi.fn().mockReturnValue("custom-dedup-id");
      const mockQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        sendBatch: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
        waitUntilReady: vi.fn().mockResolvedValue(void 0),
      };

      const queueFactory = {
        create: vi.fn().mockReturnValue(mockQueueProcessor),
      };

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        queueFactory: queueFactory as any,
      });

      const handlers = {
        handler1: createMockEventHandlerDefinition("handler1", void 0, {
          deduplication: { makeId: customDeduplicationId },
        }),
      };
      const handleEventCallback = vi.fn();

      manager.initializeHandlerQueues(handlers, handleEventCallback);

      expect(queueFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deduplication: { makeId: customDeduplicationId },
        }),
      );
    });

    it("uses no deduplication by default when handler's deduplication not provided", () => {
      const mockQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        sendBatch: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
        waitUntilReady: vi.fn().mockResolvedValue(void 0),
      };

      const queueFactory = {
        create: vi.fn().mockReturnValue(mockQueueProcessor),
      };

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        queueFactory: queueFactory as any,
      });

      const handlers = {
        handler1: createMockEventHandlerDefinition("handler1"),
      };
      const handleEventCallback = vi.fn();

      manager.initializeHandlerQueues(handlers, handleEventCallback);

      const createCall = queueFactory.create.mock.calls[0]?.[0];
      // With the new opt-in strategy, no deduplication is used by default
      expect(createCall?.deduplication).toBeUndefined();
    });

    it('uses aggregate deduplication when strategy is "aggregate"', () => {
      const mockQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        sendBatch: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
        waitUntilReady: vi.fn().mockResolvedValue(void 0),
      };

      const queueFactory = {
        create: vi.fn().mockReturnValue(mockQueueProcessor),
      };

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        queueFactory: queueFactory as any,
      });

      const handlers = {
        handler1: createMockEventHandlerDefinition("handler1", void 0, {
          deduplication: "aggregate",
        }),
      };
      const handleEventCallback = vi.fn();

      manager.initializeHandlerQueues(handlers, handleEventCallback);

      const createCall = queueFactory.create.mock.calls[0]?.[0];
      expect(createCall?.deduplication).toBeDefined();
      expect(typeof createCall?.deduplication?.makeId).toBe("function");

      // Verify the aggregate deduplication ID format
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );
      const dedupId = createCall?.deduplication?.makeId?.(event);
      expect(dedupId).toBe(
        `${tenantId}:${aggregateType}:${TEST_CONSTANTS.AGGREGATE_ID}`,
      );
    });

    it("passes handler options (delay, concurrency) to queue factory", () => {
      const mockQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        sendBatch: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
        waitUntilReady: vi.fn().mockResolvedValue(void 0),
      };

      const queueFactory = {
        create: vi.fn().mockReturnValue(mockQueueProcessor),
      };

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        queueFactory: queueFactory as any,
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
      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
      });

      const projections = {
        projection1: createMockProjectionDefinition("projection1"),
      };
      const processProjectionEventCallback = vi.fn();

      manager.initializeProjectionQueues(
        projections,
        processProjectionEventCallback,
      );

      expect(manager.hasProjectionQueues()).toBe(false);
    });

    it("initializes queue processors for all projections", () => {
      const mockQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        sendBatch: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
        waitUntilReady: vi.fn().mockResolvedValue(void 0),
      };

      const queueFactory = {
        create: vi.fn().mockReturnValue(mockQueueProcessor),
      };

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        queueFactory: queueFactory as any,
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
      expect(manager.getProjectionQueue("projection1")).toBe(
        mockQueueProcessor,
      );
      expect(manager.getProjectionQueue("projection2")).toBe(
        mockQueueProcessor,
      );
    });

    it("uses default groupKey based on aggregate for projections", () => {
      const mockQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        sendBatch: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
        waitUntilReady: vi.fn().mockResolvedValue(void 0),
      };

      const queueFactory = {
        create: vi.fn().mockReturnValue(mockQueueProcessor),
      };

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        queueFactory: queueFactory as any,
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
      expect(createCall?.groupKey).toBeDefined();

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );
      const groupKey = createCall?.groupKey?.(event);
      expect(groupKey).toBe(
        `${tenantId}:${aggregateType}:${TEST_CONSTANTS.AGGREGATE_ID}`,
      );
    });
  });

  describe("initializeCommandQueues", () => {
    it("does nothing when queue factory is not provided", () => {
      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
      });

      const commandRegistrations = [
        {
          name: "command1",
          handlerClass: createMockCommandHandlerClass("command1"),
        },
      ];
      const storeEventsFn = vi.fn();

      manager.initializeCommandQueues(
        commandRegistrations,
        storeEventsFn,
        "test-pipeline",
      );

      expect(manager.getCommandQueues().size).toBe(0);
    });

    it("initializes queue processors for all command handlers", () => {
      const mockQueueProcessor: EventSourcedQueueProcessor<any> = {
        send: vi.fn().mockResolvedValue(void 0),
        sendBatch: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
        waitUntilReady: vi.fn().mockResolvedValue(void 0),
      };

      const queueFactory = {
        create: vi.fn().mockReturnValue(mockQueueProcessor),
      };

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        queueFactory: queueFactory as any,
      });

      const commandRegistrations = [
        {
          name: "command1",
          handlerClass: createMockCommandHandlerClass("command1"),
        },
        {
          name: "command2",
          handlerClass: createMockCommandHandlerClass("command2"),
        },
      ];
      const storeEventsFn = vi.fn();

      manager.initializeCommandQueues(
        commandRegistrations,
        storeEventsFn,
        "test-pipeline",
      );

      expect(queueFactory.create).toHaveBeenCalledTimes(2);
      expect(manager.getCommandQueues().size).toBe(2);
      // The manager wraps the processor with validation, so we check the interface exists
      const command1Processor = manager.getCommandQueue("command1");
      const command2Processor = manager.getCommandQueue("command2");
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
        sendBatch: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
        waitUntilReady: vi.fn().mockResolvedValue(void 0),
      };

      const queueFactory = {
        create: vi.fn().mockReturnValue(mockQueueProcessor),
      };

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        queueFactory: queueFactory as any,
      });

      const commandRegistrations = [
        {
          name: "command1",
          handlerClass: createMockCommandHandlerClass("command1"),
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
        sendBatch: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
        waitUntilReady: vi.fn().mockResolvedValue(void 0),
      };
      const projectionQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        sendBatch: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
        waitUntilReady: vi.fn().mockResolvedValue(void 0),
      };
      const commandQueueProcessor: EventSourcedQueueProcessor<any> = {
        send: vi.fn().mockResolvedValue(void 0),
        sendBatch: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
        waitUntilReady: vi.fn().mockResolvedValue(void 0),
      };

      const queueFactory = {
        create: vi
          .fn()
          .mockReturnValueOnce(handlerQueueProcessor)
          .mockReturnValueOnce(projectionQueueProcessor)
          .mockReturnValueOnce(commandQueueProcessor),
      };

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        queueFactory: queueFactory as any,
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
          handlerClass: createMockCommandHandlerClass("command1"),
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
        sendBatch: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockRejectedValue(new Error("Close failed")),
        waitUntilReady: vi.fn().mockResolvedValue(void 0),
      };

      const queueFactory = {
        create: vi.fn().mockReturnValue(handlerQueueProcessor),
      };

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        queueFactory: queueFactory as any,
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
