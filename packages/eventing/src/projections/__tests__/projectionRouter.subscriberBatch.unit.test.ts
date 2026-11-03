/**
 * An event subscriber with a batch handler asks its queue lane to coalesce (ADR-066), and a
 * batch the queue drains reaches that handler in one call.
 * Spec: packages/eventing/specs/peer-subscriber.feature
 */
import { describe, expect, it, vi } from "vitest";

import type { Event } from "../../domain/types.ts";
import {
  createTestEvent,
  createTestTenantId,
  parseTestEvent,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers.ts";
import type { JobRegistryEntry } from "../../services/queues/jobLane.ts";
import { QueueManager } from "../../services/queues/queueManager.ts";
import type {
  EventSubscriberContext,
  EventSubscriberDefinition,
} from "../../subscribers/eventSubscriber.types.ts";
import { ProjectionRouter } from "../projectionRouter.ts";

function routerOverRegistry() {
  const registry = new Map<string, JobRegistryEntry>();
  const queueManager = new QueueManager<Event>({
    parseEvent: parseTestEvent,
    aggregateType: TEST_CONSTANTS.AGGREGATE_TYPE,
    pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
    globalQueue: {} as never,
    globalJobRegistry: registry,
  });
  const router = new ProjectionRouter<Event>({
    aggregateType: TEST_CONSTANTS.AGGREGATE_TYPE,
    pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
    queueManager,
  });
  return { registry, router };
}

function eventFor(aggregateId: string, occurredAt: number): Event {
  return createTestEvent(
    aggregateId,
    TEST_CONSTANTS.AGGREGATE_TYPE,
    createTestTenantId(),
    undefined,
    occurredAt,
    undefined,
    undefined,
    `event-${aggregateId}`,
  );
}

describe("ProjectionRouter event subscriber batching", () => {
  describe("given an event subscriber with a batch handler that coalesces up to three events", () => {
    describe("when its queue lane is registered", () => {
      /** @scenario "A batch subscriber's lane asks the queue to coalesce" */
      it("coalesces up to three jobs and hands a drained batch to the batch handler once", async () => {
        const handle = vi.fn(async () => void 0);
        const handleBatch = vi.fn(
          async (_events: readonly Event[], _contexts: readonly EventSubscriberContext[]) => void 0,
        );
        const { registry, router } = routerOverRegistry();
        router.registerEventSubscriber({
          name: "batchSubscriber",
          eventTypes: [],
          handle,
          handleBatch,
          options: { coalesceMaxBatch: 3 },
        });
        router.initializeSubscriberQueues();

        const [entry] = [...registry.values()];
        const first = eventFor("aggregate-1", 1_000);
        const second = eventFor("aggregate-2", 1_001);

        expect(entry?.route(first).coalesceMaxBatch).toBe(3);
        await entry?.readBatch?.([first, second]).run({ attempt: 2 });

        expect(handle).not.toHaveBeenCalled();
        expect(handleBatch).toHaveBeenCalledTimes(1);
        expect(handleBatch.mock.calls[0]?.[0].map(({ id }) => id)).toEqual([
          "event-aggregate-1",
          "event-aggregate-2",
        ]);
        expect(handleBatch.mock.calls[0]?.[1]).toEqual([
          { tenantId: String(first.tenantId), aggregateId: "aggregate-1", deliveryAttempt: 2 },
          { tenantId: String(second.tenantId), aggregateId: "aggregate-2", deliveryAttempt: 2 },
        ]);
      });
    });
  });

  describe("given an event subscriber without coalescing", () => {
    describe("when its queue lane is registered", () => {
      it("routes each job alone and takes no batch", () => {
        const { registry, router } = routerOverRegistry();
        router.registerEventSubscriber({
          name: "singleSubscriber",
          eventTypes: [],
          handle: async () => void 0,
        });
        router.initializeSubscriberQueues();

        const [entry] = [...registry.values()];

        expect(entry?.route(eventFor("aggregate-1", 1_000)).coalesceMaxBatch).toBe(1);
        expect(entry?.readBatch).toBeUndefined();
      });
    });
  });

  describe("given an event subscriber that coalesces but declares no batch handler", () => {
    describe("when it is registered", () => {
      /** @scenario "A peer subscriber that handles one event at a time cannot ask to coalesce" */
      it("is refused naming the subscriber", () => {
        const { router } = routerOverRegistry();
        const subscriber: EventSubscriberDefinition<Event> = {
          name: "singleSubscriber",
          eventTypes: [],
          handle: async () => void 0,
          options: { coalesceMaxBatch: 2 },
        };

        expect(() => router.registerEventSubscriber(subscriber)).toThrow(
          /singleSubscriber.*handleBatch/,
        );
      });
    });
  });
});
