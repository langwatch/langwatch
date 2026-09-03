import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Command, CommandHandler } from "../../../commands/command";
import type { CommandHandlerClass } from "../../../commands/commandHandlerClass";
import { defineCommandSchema } from "../../../commands/commandSchema";
import type { CommandType } from "../../../domain/commandType";
import type { Event } from "../../../domain/types";
import type { EventSourcedQueueProcessor } from "../../../queues";
import { createTestAggregateType } from "../../__tests__/testHelpers";
import type { JobRegistryEntry } from "../queueManager";
import { QueueManager } from "../queueManager";

/**
 * Above MIN_PLAUSIBLE_EPOCH_MS on purpose. The wider QueueManager suite pins
 * the clock at 1,000,000 ms, which a ready score can no longer legitimately
 * take, so these tests carry their own plausible clock.
 */
const NOW = 1_786_000_000_000;

function createMockSharedQueue(): EventSourcedQueueProcessor<any> {
  return {
    send: vi.fn().mockResolvedValue(void 0),
    sendBatch: vi.fn().mockResolvedValue(void 0),
    close: vi.fn().mockResolvedValue(void 0),
    waitUntilReady: vi.fn().mockResolvedValue(void 0),
  };
}

function createMockCommandHandlerClass(): CommandHandlerClass<any, CommandType, Event> {
  class MockCommandHandler implements CommandHandler<Command<any, any>, Event> {
    static readonly schema = defineCommandSchema(
      "test.command.readyScore" as CommandType,
      z.object({
        tenantId: z.string(),
        aggregateId: z.string(),
        occurredAt: z.number().optional(),
      }),
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

function createManager(globalJobRegistry: Map<string, JobRegistryEntry>) {
  return new QueueManager({
    aggregateType: createTestAggregateType(),
    pipelineName: "test-pipeline",
    globalQueue: createMockSharedQueue(),
    globalJobRegistry,
  });
}

describe("QueueManager ready scores", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a standalone job registered without its own score function", () => {
    /**
     * The source of the 2026-07-31 / 2026-08-03 spurious Events Backed Up
     * fires: this fallback used to be `?? 0`, so a payload with no occurrence
     * time staged at the epoch and reported ~56 years of age for the whole
     * queue.
     */
    /** @scenario "a standalone job with no occurrence time is scored at the current time" */
    it("scores a payload with no occurrence time at the current time", () => {
      const registry = new Map<string, JobRegistryEntry>();
      createManager(registry).registerJob({
        name: "deferredCheck",
        process: vi.fn(),
      });

      const entry = registry.get("test-pipeline:job:deferredCheck");

      expect(entry?.scoreFn({ tenantId: "t1" })).toBe(NOW);
      expect(entry?.scoreFn({ tenantId: "t1", occurredAt: NOW - 30_000 })).toBe(
        NOW - 30_000,
      );
    });

    /**
     * The repair belongs to `GroupQueue`, not here. Only there is the queue
     * name in scope to raise `gq_ready_score_implausible_total`, so quietly
     * rewriting a supplied-but-broken value at this layer would hide the
     * producer that needs fixing.
     */
    /** @scenario "a supplied occurrence time reaches the queue unrepaired" */
    it("hands a supplied but implausible occurrence time over untouched", () => {
      const registry = new Map<string, JobRegistryEntry>();
      createManager(registry).registerJob({
        name: "passThrough",
        process: vi.fn(),
      });

      const entry = registry.get("test-pipeline:job:passThrough");

      expect(entry?.scoreFn({ tenantId: "t1", occurredAt: 0 })).toBe(0);
      expect(entry?.scoreFn({ tenantId: "t1", occurredAt: Date.UTC(2021, 0, 1) })).toBe(
        Date.UTC(2021, 0, 1),
      );
    });

    it("keeps an explicitly supplied score function", () => {
      const registry = new Map<string, JobRegistryEntry>();
      createManager(registry).registerJob({
        name: "customScore",
        process: vi.fn(),
        scoreFn: () => NOW - 1_000,
      });

      expect(registry.get("test-pipeline:job:customScore")?.scoreFn({})).toBe(
        NOW - 1_000,
      );
    });
  });

  describe("given a command that is not serialized by aggregate", () => {
    /** @scenario "a command with no occurrence time is scored at the current time" */
    it("scores a payload with no occurrence time at the current time", () => {
      const registry = new Map<string, JobRegistryEntry>();
      createManager(registry).initializeCommandQueues(
        [
          {
            name: "readyScore",
            handlerClass: createMockCommandHandlerClass() as never,
            options: {},
          },
        ] as never,
        vi.fn(),
        "test-pipeline",
      );

      const entry = registry.get("test-pipeline:command:readyScore");

      expect(entry?.scoreFn({ tenantId: "t1", aggregateId: "a1" })).toBe(NOW);
      expect(
        entry?.scoreFn({
          tenantId: "t1",
          aggregateId: "a1",
          occurredAt: NOW - 42,
        }),
      ).toBe(NOW - 42);
    });
  });
});
