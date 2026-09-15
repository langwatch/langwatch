import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Command, CommandHandler } from "../../../commands/command.ts";
import type { CommandHandlerClass } from "../../../commands/commandHandlerClass.ts";
import { defineCommandSchema } from "../../../commands/commandSchema.ts";
import type { CommandType } from "../../../domain/commandType.ts";
import type { Event } from "../../../domain/types.ts";
import type { EventSourcedQueueProcessor } from "../../../queues/index.ts";
import { createTestAggregateType, TEST_CONSTANTS } from "../../__tests__/testHelpers.ts";
import type { JobRegistryEntry } from "../queueManager.ts";
import { QueueManager } from "../queueManager.ts";

/**
 * Which producers get a batch processor installed. Coalescing only engages
 * above a bound of one, so a registration that names no bound must be left on
 * the plain per-item append path: a command that appends one event per human
 * action would otherwise wait for a batch it can never fill.
 */

const payloadSchema = z.object({
  tenantId: z.string(),
  aggregateId: z.string(),
  occurredAt: z.number(),
});

function commandClass(name: string): CommandHandlerClass<any, CommandType, Event> {
  class MockCommandHandler implements CommandHandler<Command<any, any>, Event> {
    static readonly schema = defineCommandSchema(
      `test.command.${name}` as CommandType,
      payloadSchema,
    );

    static getAggregateId(payload: { aggregateId: string }): string {
      return payload.aggregateId;
    }

    async handle(): Promise<Event[]> {
      return [];
    }
  }

  return MockCommandHandler as never;
}

function sharedQueue(): EventSourcedQueueProcessor<any> {
  return {
    send: vi.fn().mockResolvedValue(void 0),
    sendBatch: vi.fn().mockResolvedValue(void 0),
    close: vi.fn().mockResolvedValue(void 0),
    waitUntilReady: vi.fn().mockResolvedValue(void 0),
  };
}

function registryFor(): Map<string, JobRegistryEntry> {
  const globalJobRegistry = new Map<string, JobRegistryEntry>();
  const manager = new QueueManager({
    aggregateType: createTestAggregateType(),
    pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
    globalQueue: sharedQueue() as never,
    globalJobRegistry,
  });

  manager.initializeCommandQueues(
    [
      // A high-fan-in producer: many items funnel onto one aggregate, so its
      // appends are worth folding.
      {
        name: "recordCorrelation",
        handlerClass: commandClass("recordCorrelation"),
        options: { coalesceMaxBatch: 256 },
      },
      // One event per human action. Nothing to fold.
      { name: "addAnnotation", handlerClass: commandClass("addAnnotation") },
    ] as never,
    vi.fn(),
    TEST_CONSTANTS.PIPELINE_NAME,
  );

  return globalJobRegistry;
}

describe("QueueManager command append coalescing", () => {
  describe("given a producer that names a batch bound", () => {
    it("installs a batch processor for it", () => {
      const entry = registryFor().get(`${TEST_CONSTANTS.PIPELINE_NAME}:command:recordCorrelation`);

      expect(entry).toBeDefined();
      expect(entry?.processBatch).toBeDefined();
    });
  });

  describe("given a command that appends one event per human action", () => {
    /** @scenario a low-fan-in producer is left alone */
    it("installs no batch processor, so it appends immediately", () => {
      const entry = registryFor().get(`${TEST_CONSTANTS.PIPELINE_NAME}:command:addAnnotation`);

      expect(entry).toBeDefined();
      expect(entry?.processBatch).toBeUndefined();
      expect(entry?.coalesceMaxBatch).toBeUndefined();
    });
  });
});
