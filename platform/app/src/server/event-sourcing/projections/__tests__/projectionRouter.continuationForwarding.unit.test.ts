/**
 * The continuation flag must survive every link of the runtime chain, because
 * any single link dropping it silently re-enables the double-apply it exists
 * to prevent (#6578): a bisected sub-batch's fold commit would REPLACE the
 * applied-event-id set instead of extending it, and the redelivery after a
 * failed later sub-batch re-applies the committed prefix.
 *
 * The links, each pinned separately (a chain test through the full runtime
 * would boot pipelines this unit lane cannot):
 * - shared-queue wrapper → registry entry: eventSourcing.deliveryForwarding
 * - registry entry → read context: THIS FILE (queue manager)
 * - read context → executor commit: THIS FILE (projection router)
 * - executor commit semantics + real store: foldRedeliveryIdempotency
 *   (integration, drives the real GroupQueue bisection end to end)
 */
import { describe, expect, it, vi } from "vitest";
import type { Event } from "../../domain/types";
import type { JobDelivery } from "../../queues";
import {
  createMockFoldProjectionDefinition,
  createMockQueueManager,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import { QueueManager } from "../../services/queues/queueManager";
import type { FoldProjectionStore } from "../foldProjection.types";
import { ProjectionRouter } from "../projectionRouter";

describe("continuation forwarding", () => {
  describe("when the queue manager's registry entry receives a batch delivery", () => {
    it("stamps deliveryAttempt and isDeliveryContinuation on the read context", async () => {
      const registry = new Map<
        string,
        {
          processBatch?: (
            events: Event[],
            delivery?: JobDelivery,
          ) => Promise<void>;
        }
      >();
      const queueManager = new QueueManager<Event>({
        aggregateType: TEST_CONSTANTS.AGGREGATE_TYPE,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        globalQueue: {} as never,
        globalJobRegistry: registry as never,
      });

      const seenContexts: Record<string, unknown>[] = [];
      queueManager.initializeProjectionQueues(
        {
          myFold: { name: "myFold", coalesceMaxBatch: 10 },
        },
        async () => {},
        async (_name, _events, context) => {
          seenContexts.push(context as unknown as Record<string, unknown>);
        },
      );

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
      const initializeSpy =
        queueManager.initializeProjectionQueues as ReturnType<typeof vi.fn>;

      const router = new ProjectionRouter(
        TEST_CONSTANTS.AGGREGATE_TYPE,
        TEST_CONSTANTS.PIPELINE_NAME,
        queueManager,
      );

      const stored: { appliedEventIds?: readonly string[] }[] = [];
      const store: FoldProjectionStore<{ count: number }> = {
        store: vi.fn(async (_state, context) => {
          stored.push({ appliedEventIds: context.appliedEventIds });
        }),
        get: vi.fn(async () => ({ count: 1 })),
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
      const onEventBatch = initializeSpy.mock.calls[0]![2] as (
        name: string,
        events: Event[],
        context: Record<string, unknown>,
      ) => Promise<void>;

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
