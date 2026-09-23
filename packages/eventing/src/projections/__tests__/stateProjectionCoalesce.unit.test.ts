// State projections' `coalesceMaxBatch` must reach the queue's batch path;
// declaration alone is dead code if any link drops it.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Event } from "../../domain/types.ts";
import { createTestTenantId, TEST_CONSTANTS } from "../../services/__tests__/testHelpers.ts";
import type { JobRegistryEntry } from "../../services/queues/queueManager.ts";
import { QueueManager } from "../../services/queues/queueManager.ts";
import { ProjectionRouter } from "../projectionRouter.ts";
import type { StateProjectionDefinition } from "../stateProjection.types.ts";

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
    let queueManager: QueueManager<Event>;

    beforeEach(() => {
      queueManager = new QueueManager<Event>({
        aggregateType: TEST_CONSTANTS.AGGREGATE_TYPE,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
      });
      vi.spyOn(queueManager, "initializeStateProjectionQueues").mockImplementation(() => void 0);
      const router = new ProjectionRouter<Event>(
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.PIPELINE_NAME,
        queueManager,
      );
      router.registerStateProjection(stateProjectionOf({ name: "batched", coalesceMaxBatch: 500 }));
      router.initializeStateProjectionQueues();
    });

    it("forwards the declared limit and a batch callback into the queue registration", () => {
      const [defs, , onEventBatch] =
        vi.mocked(queueManager.initializeStateProjectionQueues).mock.calls[0] ?? [];
      expect(defs?.batched?.coalesceMaxBatch).toBe(500);
      expect(onEventBatch).toBeTypeOf("function");
    });

    it("scores dispatch by log-accept time so delivery order agrees with the cursor", () => {
      const [defs] = vi.mocked(queueManager.initializeStateProjectionQueues).mock.calls[0] ?? [];
      // Business time a day in the past, appended now: without a createdAt
      // score this event jumps the group's queue, and the cursor its drain
      // commits silently drops everything appended before it.
      const backdated: Event = {
        id: "event-backdated",
        aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType: TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId: createTestTenantId(),
        createdAt: 2_000,
        occurredAt: 1_000,
        type: "test.event",
        version: "2025-12-17",
        data: {},
      };
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
