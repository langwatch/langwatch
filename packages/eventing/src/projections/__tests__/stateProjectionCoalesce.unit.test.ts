/**
 * The state lane's coalescing chain, pinned link by link. A state projection
 * that declares `options.coalesceMaxBatch` must actually get the queue's
 * batch path — the declaration alone is dead code if either link drops it,
 * and dropping it reproduces the 2026-08-20 production symptom (a genesis
 * import's few hundred facts draining one queue dispatch each, overrunning
 * the convergence budget and parking the organization on every pass).
 *
 * - router → queue manager: `initializeStateProjectionQueues` forwards the
 *   projection's declared limit (not the default 1) and passes a batch
 *   callback at all.
 * - queue manager → registry: the entry carries the limit and registers
 *   `processBatch`, which is the condition the GroupQueue keys batching on.
 */
import { describe, expect, it, vi } from "vitest";
import type { Event } from "../../domain/types";
import { TEST_CONSTANTS } from "../../services/__tests__/testHelpers";
import type { JobRegistryEntry } from "../../services/queues/queueManager";
import { QueueManager } from "../../services/queues/queueManager";
import { ProjectionRouter } from "../projectionRouter";
import type { StateProjectionDefinition } from "../stateProjection.types";

function stateProjectionOf({
  name,
  coalesceMaxBatch,
}: {
  name: string;
  coalesceMaxBatch?: number;
}): StateProjectionDefinition<{ count: number }, Event> {
  return {
    name,
    version: "test-1",
    eventTypes: [],
    init: () => ({ count: 0 }),
    apply: (state) => state,
    store: {
      tryLoad: async () => null,
      store: async () => undefined,
    },
    ...(coalesceMaxBatch === undefined ? {} : { options: { coalesceMaxBatch } }),
  };
}

describe("state projection coalescing wiring", () => {
  describe("when a state projection declares coalesceMaxBatch", () => {
    it("forwards the declared limit and a batch callback into the queue registration", () => {
      const queueManager = {
        initializeStateProjectionQueues: vi.fn(),
      };
      const router = new ProjectionRouter<Event>(
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.PIPELINE_NAME,
        queueManager as never,
      );
      router.registerStateProjection(stateProjectionOf({ name: "batched", coalesceMaxBatch: 500 }));

      router.initializeStateProjectionQueues();

      const [defs, , onEventBatch] =
        queueManager.initializeStateProjectionQueues.mock.calls[0] ?? [];
      expect(defs?.batched?.coalesceMaxBatch).toBe(500);
      expect(onEventBatch).toBeTypeOf("function");
    });

    it("scores dispatch by log-accept time so delivery order agrees with the cursor", () => {
      const queueManager = {
        initializeStateProjectionQueues: vi.fn(),
      };
      const router = new ProjectionRouter<Event>(
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.PIPELINE_NAME,
        queueManager as never,
      );
      router.registerStateProjection(stateProjectionOf({ name: "batched", coalesceMaxBatch: 500 }));

      router.initializeStateProjectionQueues();

      const [defs] = queueManager.initializeStateProjectionQueues.mock.calls[0] ?? [];
      // Business time a day in the past, appended now: without a createdAt
      // score this event jumps the group's queue, and the cursor its drain
      // commits silently drops everything appended before it.
      const backdated = {
        createdAt: 2_000,
        occurredAt: 1_000,
      } as unknown as Event;
      expect(defs?.batched?.scoreFn?.(backdated)).toBe(2_000);
    });
  });

  describe("when the queue manager registers the state lane", () => {
    it("puts the limit and a processBatch on the registry entry, and omits processBatch for the default of one", () => {
      const registry = new Map<string, JobRegistryEntry>();
      const queueManager = new QueueManager<Event>({
        aggregateType: TEST_CONSTANTS.AGGREGATE_TYPE,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        globalQueue: {} as never,
        globalJobRegistry: registry as never,
      });

      queueManager.initializeStateProjectionQueues(
        {
          batched: { name: "batched", coalesceMaxBatch: 500 },
          oneAtATime: { name: "oneAtATime", coalesceMaxBatch: 1 },
        },
        async () => undefined,
        async () => undefined,
      );

      const batched = registry.get(`${TEST_CONSTANTS.PIPELINE_NAME}:stateProjection:batched`);
      expect(batched?.coalesceMaxBatch).toBe(500);
      expect(batched?.processBatch).toBeDefined();

      const single = registry.get(`${TEST_CONSTANTS.PIPELINE_NAME}:stateProjection:oneAtATime`);
      expect(single?.processBatch).toBeUndefined();
    });
  });
});
