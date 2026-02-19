import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connection } from "../../../redis";
import type { EventSourcedQueueDefinition } from "../../queues";
import {
	BullmqQueueProcessorFactory,
	DefaultQueueProcessorFactory,
} from "../factory";

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const mockTracer = {
  withActiveSpan: vi.fn((_name, _options, fn) => fn()),
};

vi.mock("../../../../utils/logger/server", () => ({
  createLogger: vi.fn(() => mockLogger),
}));

vi.mock("langwatch", () => ({
  getLangWatchTracer: vi.fn(() => mockTracer),
}));

/**
 * Integration tests for queue processor factories.
 *
 * These tests require a real Redis instance to be running.
 * They verify the actual behavior of BullMQ integration when Redis is available.
 *
 * To run these tests:
 * 1. Ensure Redis is running and accessible
 * 2. Run: pnpm test -- factory.integration.test.ts
 */

function isRedisAvailable(): boolean {
  return connection !== undefined && connection !== null;
}

describe("Queue Processor Factories - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.clearAllMocks();
  });

  // Skip all tests if Redis is not available
  const describeIfRedis = isRedisAvailable() ? describe : describe.skip;

  describeIfRedis("DefaultQueueProcessorFactory with Redis", () => {
    let factory: DefaultQueueProcessorFactory;

    beforeEach(() => {
      factory = new DefaultQueueProcessorFactory();
    });

    it("returns working BullMQ processor when Redis is available", async () => {
      const processFn = vi.fn().mockResolvedValue(void 0);
      const definition: EventSourcedQueueDefinition<{ id: string }> = {
        name: `test-queue-factory-${Date.now()}`,
        process: processFn,
        groupKey: (payload) => payload.id,
      };

      const processor = factory.create(definition);

      // Test that the processor implements the interface
      expect(processor).toHaveProperty("send");
      expect(processor).toHaveProperty("close");

      await processor.close();
    });

    it("adapts to connection state - creates BullMQ processor when Redis available", async () => {
      const processFn = vi.fn().mockResolvedValue(void 0);
      const definition: EventSourcedQueueDefinition<{ id: string }> = {
        name: `test-queue-adapt-${Date.now()}`,
        process: processFn,
        groupKey: (payload) => payload.id,
      };

      const processor = factory.create(definition);

      // Verify it has the expected interface
      expect(processor).toHaveProperty("send");
      expect(processor).toHaveProperty("close");

      await processor.close();
    });
  });

  describeIfRedis("BullmqQueueProcessorFactory with Redis", () => {
    let factory: BullmqQueueProcessorFactory;

    beforeEach(() => {
      factory = new BullmqQueueProcessorFactory();
    });

    it("returns working BullMQ processor when Redis is available", async () => {
      const processFn = vi.fn().mockResolvedValue(void 0);
      const definition: EventSourcedQueueDefinition<{ id: string }> = {
        name: `test-queue-bullmq-${Date.now()}`,
        process: processFn,
        groupKey: (payload) => payload.id,
      };

      const processor = factory.create(definition);

      expect(processor).toHaveProperty("send");
      expect(processor).toHaveProperty("close");

      await processor.close();
    });
  });
});
