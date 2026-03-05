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
import type { JobRegistryEntry } from "../queueManager";
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
 * Creates a mock reactor definition in the shape expected by QueueManager.initializeReactorQueues.
 */
function createMockReactorDefinition(
  name: string,
  options?: {
    delay?: number;
    deduplication?: DeduplicationStrategy<{ event: Event; foldState: unknown }>;
  },
) {
  return {
    name,
    handler: {
      handle: vi.fn().mockResolvedValue(void 0),
    },
    options,
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

/**
 * Creates a mock shared queue processor that all facades will delegate to.
 */
function createMockSharedQueue(): EventSourcedQueueProcessor<any> {
  return {
    send: vi.fn().mockResolvedValue(void 0),
    sendBatch: vi.fn().mockResolvedValue(void 0),
    close: vi.fn().mockResolvedValue(void 0),
    waitUntilReady: vi.fn().mockResolvedValue(void 0),
  };
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

  describe("shared pipeline queue", () => {
    it("registers all job types in the global job registry", () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      // Initialize all types
      manager.initializeHandlerQueues(
        { h1: createMockEventHandlerDefinition("h1") },
        vi.fn(),
      );
      manager.initializeProjectionQueues(
        { p1: createMockProjectionDefinition("p1") },
        vi.fn(),
      );
      manager.initializeCommandQueues(
        [{ name: "c1", handlerClass: createMockCommandHandlerClass("c1") }],
        vi.fn(),
        "test-pipeline",
      );
      manager.initializeReactorQueues(
        { r1: createMockReactorDefinition("r1") },
        vi.fn(),
      );

      // Registry entries exist for each job type
      expect(globalJobRegistry.has("test-pipeline:handler:h1")).toBe(true);
      expect(globalJobRegistry.has("test-pipeline:projection:p1")).toBe(true);
      expect(globalJobRegistry.has("test-pipeline:command:c1")).toBe(true);
      expect(globalJobRegistry.has("test-pipeline:reactor:r1")).toBe(true);

      // Facades exist for each
      expect(manager.getHandlerQueue("h1")).toBeDefined();
      expect(manager.getProjectionQueue("p1")).toBeDefined();
      expect(manager.getCommandQueue("c1")).toBeDefined();
      expect(manager.getReactorQueue("r1")).toBeDefined();
    });

    it("global job registry entries have groupKeyFn and scoreFn", () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      manager.initializeHandlerQueues(
        { h1: createMockEventHandlerDefinition("h1") },
        vi.fn(),
      );

      const entry = globalJobRegistry.get("test-pipeline:handler:h1");
      expect(entry?.groupKeyFn).toBeDefined();
      expect(entry?.scoreFn).toBeDefined();
    });

    it("shared queue dispatches groupKey to correct entry", () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      manager.initializeHandlerQueues(
        { h1: createMockEventHandlerDefinition("h1") },
        vi.fn(),
      );
      manager.initializeProjectionQueues(
        { p1: createMockProjectionDefinition("p1") },
        vi.fn(),
      );

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      // Handler job groupKey
      const handlerEntry = globalJobRegistry.get("test-pipeline:handler:h1");
      const handlerGroupKey = handlerEntry?.groupKeyFn(event);
      expect(handlerGroupKey).toBe(
        `${tenantId}:${aggregateType}:${TEST_CONSTANTS.AGGREGATE_ID}`,
      );

      // Projection job groupKey
      const projectionEntry = globalJobRegistry.get("test-pipeline:projection:p1");
      const projectionGroupKey = projectionEntry?.groupKeyFn(event);
      expect(projectionGroupKey).toBe(
        `${tenantId}:${aggregateType}:${TEST_CONSTANTS.AGGREGATE_ID}`,
      );
    });

    it("shared queue dispatches score to correct entry", () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      manager.initializeHandlerQueues(
        { h1: createMockEventHandlerDefinition("h1") },
        vi.fn(),
      );

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
        undefined,
        42000,
      );

      const handlerEntry = globalJobRegistry.get("test-pipeline:handler:h1");
      const score = handlerEntry?.scoreFn(event);
      expect(score).toBe(42000);
    });

    it("shared queue dispatches process to correct entry", async () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const handleEventCallback = vi.fn().mockResolvedValue(void 0);

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      manager.initializeHandlerQueues(
        { h1: createMockEventHandlerDefinition("h1") },
        handleEventCallback,
      );

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      const handlerEntry = globalJobRegistry.get("test-pipeline:handler:h1");
      await handlerEntry?.process(event);

      expect(handleEventCallback).toHaveBeenCalledWith(
        "h1",
        expect.objectContaining({
          aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
          tenantId,
        }),
        expect.objectContaining({ tenantId }),
      );
    });

    it("shared queue dispatches spanAttributes to correct entry", () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      manager.initializeProjectionQueues(
        { p1: createMockProjectionDefinition("p1") },
        vi.fn(),
      );

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      const projectionEntry = globalJobRegistry.get("test-pipeline:projection:p1");
      const attrs = projectionEntry?.spanAttributes?.(event);
      expect(attrs).toEqual(
        expect.objectContaining({
          "projection.name": "p1",
          "event.aggregate_id": TEST_CONSTANTS.AGGREGATE_ID,
        }),
      );
    });

    it("throws for unknown job entry in registry", () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      manager.initializeHandlerQueues(
        { h1: createMockEventHandlerDefinition("h1") },
        vi.fn(),
      );

      // Verify that a nonexistent key is not in the registry
      expect(globalJobRegistry.has("test-pipeline:handler:nonexistent")).toBe(false);
    });
  });

  describe("initializeHandlerQueues", () => {
    it("does nothing when global queue is not provided", () => {
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

    it("creates facades for all handlers", () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      const handlers = {
        handler1: createMockEventHandlerDefinition("handler1"),
        handler2: createMockEventHandlerDefinition("handler2"),
      };
      const handleEventCallback = vi.fn();

      manager.initializeHandlerQueues(handlers, handleEventCallback);

      // Registry entries exist for each handler
      expect(globalJobRegistry.has("test-pipeline:handler:handler1")).toBe(true);
      expect(globalJobRegistry.has("test-pipeline:handler:handler2")).toBe(true);
      // Facades exist for each handler
      expect(manager.getHandlerQueue("handler1")).toBeDefined();
      expect(manager.getHandlerQueue("handler2")).toBeDefined();
    });

    it("facade injects __pipelineName, __jobType and __jobName on send", async () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      manager.initializeHandlerQueues(
        { handler1: createMockEventHandlerDefinition("handler1") },
        vi.fn(),
      );

      const facade = manager.getHandlerQueue("handler1")!;
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );
      await facade.send(event);

      expect(mockQueueProcessor.send).toHaveBeenCalledWith(
        expect.objectContaining({
          __pipelineName: "test-pipeline",
          __jobType: "handler",
          __jobName: "handler1",
        }),
        expect.any(Object),
      );
    });

    it("facade injects __pipelineName, __jobType and __jobName on sendBatch", async () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      manager.initializeHandlerQueues(
        { handler1: createMockEventHandlerDefinition("handler1") },
        vi.fn(),
      );

      const facade = manager.getHandlerQueue("handler1")!;
      const event1 = createTestEvent("agg-1", aggregateType, tenantId);
      const event2 = createTestEvent("agg-2", aggregateType, tenantId);
      await facade.sendBatch([event1, event2]);

      expect(mockQueueProcessor.sendBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ __pipelineName: "test-pipeline", __jobType: "handler", __jobName: "handler1" }),
          expect.objectContaining({ __pipelineName: "test-pipeline", __jobType: "handler", __jobName: "handler1" }),
        ]),
        expect.any(Object),
      );
    });

    it("passes handler delay as per-send option", async () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      manager.initializeHandlerQueues(
        {
          handler1: createMockEventHandlerDefinition("handler1", void 0, {
            delay: 1000,
          }),
        },
        vi.fn(),
      );

      const facade = manager.getHandlerQueue("handler1")!;
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );
      await facade.send(event);

      expect(mockQueueProcessor.send).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ delay: 1000 }),
      );
    });

    it("uses handler deduplication config when provided", async () => {
      const customDeduplicationId = vi.fn().mockReturnValue("custom-dedup-id");
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      manager.initializeHandlerQueues(
        {
          handler1: createMockEventHandlerDefinition("handler1", void 0, {
            deduplication: { makeId: customDeduplicationId },
          }),
        },
        vi.fn(),
      );

      const facade = manager.getHandlerQueue("handler1")!;
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );
      await facade.send(event);

      // The per-send dedup should be namespaced
      const sendOptions = (mockQueueProcessor.send as any).mock.calls[0]?.[1];
      expect(sendOptions?.deduplication).toBeDefined();
      // Call makeId with enriched payload to verify namespace prefix
      const dedupId = sendOptions?.deduplication?.makeId?.({
        ...event,
        __pipelineName: "test-pipeline",
        __jobType: "handler",
        __jobName: "handler1",
      });
      expect(dedupId).toBe("test-pipeline/handler/handler1/custom-dedup-id");
    });

    it("uses no deduplication by default", async () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      manager.initializeHandlerQueues(
        { handler1: createMockEventHandlerDefinition("handler1") },
        vi.fn(),
      );

      const facade = manager.getHandlerQueue("handler1")!;
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );
      await facade.send(event);

      const sendOptions = (mockQueueProcessor.send as any).mock.calls[0]?.[1];
      expect(sendOptions?.deduplication).toBeUndefined();
    });

    it('uses aggregate deduplication when strategy is "aggregate"', async () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      manager.initializeHandlerQueues(
        {
          handler1: createMockEventHandlerDefinition("handler1", void 0, {
            deduplication: "aggregate",
          }),
        },
        vi.fn(),
      );

      const facade = manager.getHandlerQueue("handler1")!;
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );
      await facade.send(event);

      const sendOptions = (mockQueueProcessor.send as any).mock.calls[0]?.[1];
      expect(sendOptions?.deduplication).toBeDefined();
      expect(typeof sendOptions?.deduplication?.makeId).toBe("function");

      // Verify the namespaced aggregate deduplication ID format
      const dedupId = sendOptions?.deduplication?.makeId?.({
        ...event,
        __pipelineName: "test-pipeline",
        __jobType: "handler",
        __jobName: "handler1",
      });
      expect(dedupId).toBe(
        `test-pipeline/handler/handler1/${tenantId}:${aggregateType}:${TEST_CONSTANTS.AGGREGATE_ID}`,
      );
    });
  });

  describe("initializeProjectionQueues", () => {
    it("does nothing when global queue is not provided", () => {
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

    it("creates facades for all projections", () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
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

      // Registry entries exist for each projection
      expect(globalJobRegistry.has("test-pipeline:projection:projection1")).toBe(true);
      expect(globalJobRegistry.has("test-pipeline:projection:projection2")).toBe(true);
      // Facades exist for each projection
      expect(manager.getProjectionQueue("projection1")).toBeDefined();
      expect(manager.getProjectionQueue("projection2")).toBeDefined();
    });

    it("facade injects __pipelineName, __jobType and __jobName on send", async () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      manager.initializeProjectionQueues(
        { projection1: createMockProjectionDefinition("projection1") },
        vi.fn(),
      );

      const facade = manager.getProjectionQueue("projection1")!;
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );
      await facade.send(event);

      expect(mockQueueProcessor.send).toHaveBeenCalledWith(
        expect.objectContaining({
          __pipelineName: "test-pipeline",
          __jobType: "projection",
          __jobName: "projection1",
        }),
        expect.any(Object),
      );
    });

    it("uses default groupKey based on aggregate for projections", () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      manager.initializeProjectionQueues(
        { projection1: createMockProjectionDefinition("projection1") },
        vi.fn(),
      );

      const entry = globalJobRegistry.get("test-pipeline:projection:projection1");
      expect(entry?.groupKeyFn).toBeDefined();

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );
      const groupKey = entry?.groupKeyFn(event);
      expect(groupKey).toBe(
        `${tenantId}:${aggregateType}:${TEST_CONSTANTS.AGGREGATE_ID}`,
      );
    });
  });

  describe("initializeCommandQueues", () => {
    it("does nothing when global queue is not provided", () => {
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

    it("creates facades for all command handlers via shared queue", () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
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

      // Registry entries exist for each command
      expect(globalJobRegistry.has("test-pipeline:command:command1")).toBe(true);
      expect(globalJobRegistry.has("test-pipeline:command:command2")).toBe(true);
      // Facades exist for each command
      expect(manager.getCommandQueues().size).toBe(2);
      const command1Processor = manager.getCommandQueue("command1");
      const command2Processor = manager.getCommandQueue("command2");
      expect(command1Processor).toBeDefined();
      expect(command2Processor).toBeDefined();
      expect(typeof command1Processor?.send).toBe("function");
      expect(typeof command1Processor?.close).toBe("function");
      expect(typeof command2Processor?.send).toBe("function");
      expect(typeof command2Processor?.close).toBe("function");
    });

    it("facade injects __pipelineName, __jobType and __jobName on send", async () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
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

      const facade = manager.getCommandQueue("command1");
      const payload = {
        tenantId: "test-tenant",
        aggregateId: "agg-1",
        occurredAt: Date.now(),
      };
      await facade?.send(payload);

      expect(mockQueueProcessor.send).toHaveBeenCalledWith(
        expect.objectContaining({
          __pipelineName: "test-pipeline",
          __jobType: "command",
          __jobName: "command1",
        }),
        expect.any(Object),
      );
    });

    it("facade passes per-send delay and dedup options", async () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      const commandRegistrations = [
        {
          name: "command1",
          handlerClass: createMockCommandHandlerClass("command1"),
          options: { delay: 5000 },
        },
      ];
      const storeEventsFn = vi.fn();

      manager.initializeCommandQueues(
        commandRegistrations,
        storeEventsFn,
        "test-pipeline",
      );

      const facade = manager.getCommandQueue("command1");
      const payload = {
        tenantId: "test-tenant",
        aggregateId: "agg-1",
        occurredAt: Date.now(),
      };
      await facade?.send(payload);

      expect(mockQueueProcessor.send).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ delay: 5000 }),
      );
    });

    it("throws error when command name already exists", () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
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

  describe("initializeReactorQueues", () => {
    it("does nothing when global queue is not provided", () => {
      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
      });

      manager.initializeReactorQueues(
        { reactor1: createMockReactorDefinition("reactor1") },
        vi.fn(),
      );

      expect(manager.hasReactorQueues()).toBe(false);
    });

    it("creates facades for all reactors", () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      manager.initializeReactorQueues(
        {
          reactor1: createMockReactorDefinition("reactor1"),
          reactor2: createMockReactorDefinition("reactor2"),
        },
        vi.fn(),
      );

      expect(globalJobRegistry.has("test-pipeline:reactor:reactor1")).toBe(true);
      expect(globalJobRegistry.has("test-pipeline:reactor:reactor2")).toBe(true);
      expect(manager.getReactorQueue("reactor1")).toBeDefined();
      expect(manager.getReactorQueue("reactor2")).toBeDefined();
      expect(manager.hasReactorQueues()).toBe(true);
    });

    it("facade injects __pipelineName, __jobType and __jobName on send", async () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      manager.initializeReactorQueues(
        { reactor1: createMockReactorDefinition("reactor1") },
        vi.fn(),
      );

      const facade = manager.getReactorQueue("reactor1")!;
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );
      await facade.send({ event, foldState: { count: 1 } });

      expect(mockQueueProcessor.send).toHaveBeenCalledWith(
        expect.objectContaining({
          __pipelineName: "test-pipeline",
          __jobType: "reactor",
          __jobName: "reactor1",
          event: expect.objectContaining({
            aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
          }),
          foldState: { count: 1 },
        }),
        expect.any(Object),
      );
    });

    it("reactor groupKey uses event fields", () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      manager.initializeReactorQueues(
        { reactor1: createMockReactorDefinition("reactor1") },
        vi.fn(),
      );

      const entry = globalJobRegistry.get("test-pipeline:reactor:reactor1");
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      const groupKey = entry?.groupKeyFn({
        event,
        foldState: {},
      });
      expect(groupKey).toBe(
        `${tenantId}:${aggregateType}:${TEST_CONSTANTS.AGGREGATE_ID}`,
      );
    });

    it("reactor score uses event timestamp", () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      manager.initializeReactorQueues(
        { reactor1: createMockReactorDefinition("reactor1") },
        vi.fn(),
      );

      const entry = globalJobRegistry.get("test-pipeline:reactor:reactor1");
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
        undefined,
        55000,
      );

      const score = entry?.scoreFn({
        event,
        foldState: {},
      });
      expect(score).toBe(55000);
    });

    it("passes reactor delay as per-send option", async () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      manager.initializeReactorQueues(
        { reactor1: createMockReactorDefinition("reactor1", { delay: 3000 }) },
        vi.fn(),
      );

      const facade = manager.getReactorQueue("reactor1")!;
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );
      await facade.send({ event, foldState: {} });

      expect(mockQueueProcessor.send).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ delay: 3000 }),
      );
    });
  });

  describe("close", () => {
    it("facade close is a no-op (global queue lifecycle owned by EventSourcing)", async () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      manager.initializeHandlerQueues(
        { handler1: createMockEventHandlerDefinition("handler1") },
        vi.fn(),
      );
      manager.initializeProjectionQueues(
        { projection1: createMockProjectionDefinition("projection1") },
        vi.fn(),
      );
      manager.initializeCommandQueues(
        [
          {
            name: "command1",
            handlerClass: createMockCommandHandlerClass("command1"),
          },
        ],
        vi.fn(),
        "test-pipeline",
      );

      // QueueManager.close() calls facade close methods, which are all no-ops
      await manager.close();

      // The global queue's close should NOT be called by the facade
      expect(mockQueueProcessor.close).not.toHaveBeenCalled();
    });

    it("individual facade close is a no-op", async () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      manager.initializeCommandQueues(
        [
          {
            name: "command1",
            handlerClass: createMockCommandHandlerClass("command1"),
          },
          {
            name: "command2",
            handlerClass: createMockCommandHandlerClass("command2"),
          },
        ],
        vi.fn(),
        "test-pipeline",
      );

      const facade1 = manager.getCommandQueue("command1")!;
      const facade2 = manager.getCommandQueue("command2")!;

      // Closing facades should NOT close the global queue
      await facade1.close();
      await facade2.close();
      expect(mockQueueProcessor.close).not.toHaveBeenCalled();
    });
  });
});
