// Continuation flag must survive the runtime chain to prevent double-apply
// (#6578); each link is pinned separately to catch drops early.
import { describe, expect, it, vi } from "vitest";

import type { Event } from "../../domain/types.ts";
import type { JobDelivery } from "../../queues/index.ts";
import {
  createMockFoldProjectionDefinition,
  createMockQueueManager,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers.ts";
import { QueueManager } from "../../services/queues/queueManager.ts";
import type { FoldProjectionStore } from "../foldProjection.types.ts";
import { ProjectionRouter } from "../projectionRouter.ts";

describe("continuation forwarding", () => {
  describe("when the queue manager's registry entry receives a batch delivery", () => {
    it("stamps deliveryAttempt and isDeliveryContinuation on the read context", async () => {
      const registry = new Map<
        string,
        {
          processBatch?: (events: Event[], delivery?: JobDelivery) => Promise<void>;
        }
      >();
      const queueManager = new QueueManager<Event>({
        aggregateType: TEST_CONSTANTS.AGGREGATE_TYPE,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        globalQueue: {} as never,
        globalJobRegistry: registry as never,
      });

      const seenContexts: unknown[] = [];
      queueManager.initializeProjectionQueues({
        projections: {
          myFold: { name: "myFold", coalesceMaxBatch: 10 },
        },
        onEvent: async () => {},
        onEventBatch: async (_name, _events, context) => {
          seenContexts.push(context);
        },
      });

      const entry = [...registry.values()][0]!;
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        createTestTenantId(),
      );
      const delivery: JobDelivery = { attempt: 2, isContinuation: true };
      await entry.processBatch!([event], delivery);

      expect(seenContexts[0]).toMatchObject({
        deliveryAttempt: 2,
        isDeliveryContinuation: true,
      });
    });
  });

  describe("when the router's batch callback receives a continuation context", () => {
    it("commits with the applied set extended rather than replaced", async () => {
      const queueManager = createMockQueueManager();

      const router = new ProjectionRouter({
        aggregateType: TEST_CONSTANTS.AGGREGATE_TYPE,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        queueManager,
      });

      const stored: { appliedEventIds?: readonly string[] }[] = [];
      const store: FoldProjectionStore<{ count: number }> = {
        store: vi.fn(async (_state, context) => {
          stored.push({ appliedEventIds: context.appliedEventIds });
        }),
        get: vi.fn(async () => ({ kind: "folded" as const, state: { count: 1 } })),
        getWithApplied: vi.fn(async () => ({
          state: { count: 1 },
          appliedEventIds: ["prev-1", "prev-2"],
        })),
      };
      const fold = createMockFoldProjectionDefinition("continuation-fold", {
        store,
        eventTypes: [],
        init: () => ({ count: 0 }),
        apply: (state: { count: number }) => ({ count: state.count + 1 }),
      });
      router.registerFoldProjection(fold);
      router.initializeFoldQueues();

      // The batch callback the router handed the queue manager — the exact
      // function the runtime invokes for a coalesced fold batch.
      const [request] = vi.mocked(queueManager.initializeProjectionQueues).mock.calls[0] ?? [];
      const onEventBatch = request?.onEventBatch;
      if (!onEventBatch) throw new Error("the router registered no batch callback");

      const tenantId = createTestTenantId();
      const makeEvents = (ids: string[]) =>
        ids.map((id, index) => {
          const event = createTestEvent(
            TEST_CONSTANTS.AGGREGATE_ID,
            TEST_CONSTANTS.AGGREGATE_TYPE,
            tenantId,
          );
          return {
            ...event,
            id,
            occurredAt: TEST_CONSTANTS.BASE_TIMESTAMP + index,
          } as Event;
        });

      // Continuation: the commit must carry the loaded ids AND the new ones.
      await onEventBatch("continuation-fold", makeEvents(["new-1", "new-2"]), {
        tenantId,
        isDeliveryContinuation: true,
      });
      expect(stored[0]?.appliedEventIds).toEqual(
        expect.arrayContaining(["prev-1", "prev-2", "new-1", "new-2"]),
      );

      // Fresh delivery: the commit replaces — the bounded-set garbage
      // collection this chain must NOT break.
      await onEventBatch("continuation-fold", makeEvents(["new-3", "new-4"]), {
        tenantId,
      });
      expect(stored[1]?.appliedEventIds).toEqual(["new-3", "new-4"]);
    });
  });
});
