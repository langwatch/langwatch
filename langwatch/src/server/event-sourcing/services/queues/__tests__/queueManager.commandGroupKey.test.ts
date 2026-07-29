import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Command, CommandHandler } from "../../../commands/command";
import type { CommandHandlerClass } from "../../../commands/commandHandlerClass";
import { defineCommandSchema } from "../../../commands/commandSchema";
import type { CommandType } from "../../../domain/commandType";
import type { Event } from "../../../domain/types";
import type { EventSourcedQueueProcessor } from "../../../queues";
import {
  createTestAggregateType,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../__tests__/testHelpers";
import type { JobRegistryEntry } from "../queueManager";
import { QueueManager } from "../queueManager";

const payloadSchema = z.object({
  tenantId: z.string(),
  aggregateId: z.string(),
  experimentId: z.string().optional(),
  runId: z.string().optional(),
  index: z.number().optional(),
  occurredAt: z.number(),
});

function createMockCommandHandlerClass(
  name: string,
): CommandHandlerClass<any, CommandType, Event> {
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

function createMockCommandHandlerClassWithGroupKey(
  name: string,
): CommandHandlerClass<any, CommandType, Event> {
  class MockCommandHandlerWithGroupKey
    implements CommandHandler<Command<any, any>, Event>
  {
    static readonly schema = defineCommandSchema(
      `test.command.${name}` as CommandType,
      payloadSchema,
    );

    static getAggregateId(payload: any): string {
      return payload.aggregateId;
    }

    static getGroupKey(payload: any): string {
      return `${payload.experimentId}:${payload.runId}:item:${payload.index}`;
    }

    async handle(_command: Command<any, any>): Promise<Event[]> {
      return [];
    }
  }

  return MockCommandHandlerWithGroupKey as any;
}

function createMockSharedQueue(): EventSourcedQueueProcessor<any> {
  return {
    send: vi.fn().mockResolvedValue(void 0),
    sendBatch: vi.fn().mockResolvedValue(void 0),
    close: vi.fn().mockResolvedValue(void 0),
    waitUntilReady: vi.fn().mockResolvedValue(void 0),
  };
}

describe("QueueManager.initializeCommandQueues with getGroupKey", () => {
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

  describe("when getGroupKey is defined on the command class", () => {
    it("uses the class-level getGroupKey for queue routing", () => {
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
            name: "recordResult",
            handlerClass:
              createMockCommandHandlerClassWithGroupKey("recordResult"),
          },
        ],
        vi.fn(),
        "test-pipeline",
      );

      const entry = globalJobRegistry.get("test-pipeline:command:recordResult");
      expect(entry?.groupKeyFn).toBeDefined();

      const payload = {
        tenantId: String(tenantId),
        aggregateId: "exp1:run1",
        experimentId: "exp1",
        runId: "run1",
        index: 42,
        occurredAt: 1000,
      };

      const groupKey = entry?.groupKeyFn(payload);
      expect(groupKey).toBe(
        `${tenantId}/command/recordResult/${aggregateType}:exp1:run1:item:42`,
      );
    });
  });

  describe("when getGroupKey is not defined", () => {
    it("falls back to getAggregateId for queue routing", () => {
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
            name: "startRun",
            handlerClass: createMockCommandHandlerClass("startRun"),
          },
        ],
        vi.fn(),
        "test-pipeline",
      );

      const entry = globalJobRegistry.get("test-pipeline:command:startRun");
      expect(entry?.groupKeyFn).toBeDefined();

      const payload = {
        tenantId: String(tenantId),
        aggregateId: "exp1:run1",
        occurredAt: 1000,
      };

      const groupKey = entry?.groupKeyFn(payload);
      expect(groupKey).toBe(
        `${tenantId}/command/startRun/${aggregateType}:exp1:run1`,
      );
    });
  });

  describe("when getGroupKey is provided via options", () => {
    it("prefers options getGroupKey over class-level getGroupKey", () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      const optionsGroupKey = (payload: any) => `custom:${payload.aggregateId}`;

      manager.initializeCommandQueues(
        [
          {
            name: "recordResult",
            handlerClass:
              createMockCommandHandlerClassWithGroupKey("recordResult"),
            options: { getGroupKey: optionsGroupKey },
          },
        ],
        vi.fn(),
        "test-pipeline",
      );

      const entry = globalJobRegistry.get("test-pipeline:command:recordResult");

      const payload = {
        tenantId: String(tenantId),
        aggregateId: "exp1:run1",
        experimentId: "exp1",
        runId: "run1",
        index: 42,
        occurredAt: 1000,
      };

      const groupKey = entry?.groupKeyFn(payload);
      expect(groupKey).toBe(
        `${tenantId}/command/recordResult/${aggregateType}:custom:exp1:run1`,
      );
    });
  });
});

// ADR-066 pillar 2 — append coalescing wiring + the un-coalesced-producer
// visibility record. See specs/event-sourcing/producer-append-coalescing.feature.
describe("QueueManager.initializeCommandQueues append coalescing", () => {
  const aggregateType = createTestAggregateType();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function buildManager() {
    const globalJobRegistry = new Map<string, JobRegistryEntry>();
    const manager = new QueueManager({
      aggregateType,
      pipelineName: "test-pipeline",
      globalQueue: createMockSharedQueue(),
      globalJobRegistry,
    });
    return { manager, globalJobRegistry };
  }

  function loggerInfoSpyOf(manager: QueueManager) {
    return vi.spyOn(
      (manager as unknown as { logger: { info: (...a: any[]) => void } })
        .logger,
      "info",
    );
  }

  describe("given a command that opts into coalescing", () => {
    describe("when the command queue is initialized", () => {
      it("wires coalesceMaxBatch, coalesceMaxBytes, and processBatch onto the registry entry", () => {
        const { manager, globalJobRegistry } = buildManager();

        manager.initializeCommandQueues(
          [
            {
              name: "hot",
              handlerClass: createMockCommandHandlerClass("hot"),
              options: {
                serializeByAggregate: true,
                coalesceMaxBatch: 200,
                coalesceMaxBytes: 1024,
              },
            },
          ],
          vi.fn(),
          "test-pipeline",
        );

        const entry = globalJobRegistry.get("test-pipeline:command:hot");
        expect(entry?.coalesceMaxBatch).toBe(200);
        expect(entry?.coalesceMaxBytes).toBe(1024);
        expect(entry?.processBatch).toBeDefined();
      });
    });
  });

  describe("given a command that does not coalesce", () => {
    describe("when the command queue is initialized", () => {
      it("leaves processBatch and the coalesce bounds unset", () => {
        const { manager, globalJobRegistry } = buildManager();

        manager.initializeCommandQueues(
          [
            {
              name: "cold",
              handlerClass: createMockCommandHandlerClass("cold"),
              options: { serializeByAggregate: true },
            },
          ],
          vi.fn(),
          "test-pipeline",
        );

        const entry = globalJobRegistry.get("test-pipeline:command:cold");
        expect(entry?.processBatch).toBeUndefined();
        expect(entry?.coalesceMaxBatch).toBeUndefined();
      });
    });
  });

  describe("given a serialized producer registered without coalescing", () => {
    describe("when the command queue is initialized", () => {
      /** @scenario 'an un-coalesced high-fan-in producer is visible, not silent' */
      it("emits a record naming the producer and its pipeline", () => {
        const { manager } = buildManager();
        const infoSpy = loggerInfoSpyOf(manager);

        manager.initializeCommandQueues(
          [
            {
              name: "cold",
              handlerClass: createMockCommandHandlerClass("cold"),
              options: { serializeByAggregate: true },
            },
          ],
          vi.fn(),
          "test-pipeline",
        );

        expect(infoSpy).toHaveBeenCalledWith(
          { pipeline: "test-pipeline", command: "cold" },
          "serialized command producer registered without append coalescing",
        );
      });
    });
  });

  describe("given a serialized producer that DOES coalesce", () => {
    describe("when the command queue is initialized", () => {
      it("does not emit the un-coalesced visibility record", () => {
        const { manager } = buildManager();
        const infoSpy = loggerInfoSpyOf(manager);

        manager.initializeCommandQueues(
          [
            {
              name: "hot",
              handlerClass: createMockCommandHandlerClass("hot"),
              options: { serializeByAggregate: true, coalesceMaxBatch: 200 },
            },
          ],
          vi.fn(),
          "test-pipeline",
        );

        expect(infoSpy).not.toHaveBeenCalledWith(
          expect.anything(),
          "serialized command producer registered without append coalescing",
        );
      });
    });
  });
});

describe("QueueManager.initializeHandlerQueues with groupKeyFn", () => {
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

  describe("when groupKeyFn is provided in handler options", () => {
    it("uses the custom groupKeyFn with tenantId prefix", () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      const customGroupKeyFn = (event: Event) =>
        `result:${(event.data as any).runId}:item:${(event.data as any).index}`;

      const handlers = {
        resultStorage: {
          name: "resultStorage",
          handler: { handle: vi.fn().mockResolvedValue(void 0) },
          options: {
            eventTypes: ["target_result"] as readonly string[],
            groupKeyFn: customGroupKeyFn,
          },
        },
      };

      manager.initializeHandlerQueues(handlers, vi.fn());

      const entry = globalJobRegistry.get(
        "test-pipeline:handler:resultStorage",
      );
      expect(entry?.groupKeyFn).toBeDefined();

      const event = {
        tenantId,
        aggregateType,
        aggregateId: "exp1:run1",
        data: { runId: "run1", index: 5 },
        createdAt: 1000,
      };

      const groupKey = entry?.groupKeyFn(event);
      expect(groupKey).toBe(`${tenantId}/map/resultStorage/result:run1:item:5`);
    });
  });

  describe("when groupKeyFn is not provided in handler options", () => {
    it("uses default aggregate-based group key", () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      const handlers = {
        resultStorage: {
          name: "resultStorage",
          handler: { handle: vi.fn().mockResolvedValue(void 0) },
          options: {
            eventTypes: ["target_result"] as readonly string[],
          },
        },
      };

      manager.initializeHandlerQueues(handlers, vi.fn());

      const entry = globalJobRegistry.get(
        "test-pipeline:handler:resultStorage",
      );

      const event = {
        tenantId,
        aggregateType,
        aggregateId: "exp1:run1",
        createdAt: 1000,
      };

      const groupKey = entry?.groupKeyFn(event);
      expect(groupKey).toBe(
        `${tenantId}/map/resultStorage/${aggregateType}:exp1:run1`,
      );
    });
  });
});
