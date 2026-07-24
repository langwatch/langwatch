/**
 * @vitest-environment node
 *
 * The enqueue-time subscriber contract (payload-cost doctrine invariant 4 —
 * ADR-069), proven at the fan-out seam. These drive the real ProjectionRouter
 * over its synchronous (no-queue) dispatch path, so what a subscriber's handler
 * receives is exactly what the seam would have staged.
 *
 * Guarantees under test:
 *   - a `filter` returning false never mints a job;
 *   - a `filter` that throws fails loudly into the routing retry, never a
 *     silent drop;
 *   - without a filter, the full event is staged unchanged; and
 *   - each outcome is counted on `es_subscriber_enqueue_total`.
 *
 * @see specs/event-sourcing/payload-cost.feature
 */
import { register } from "prom-client";
import { describe, expect, it } from "vitest";

import type { Event } from "../../domain/types";
import { ProjectionRouter } from "../../projections/projectionRouter";
import { QueueManager } from "../../services/queues/queueManager";
import {
  createTestAggregateType,
  createTestEvent,
  createTestEventStoreReadContext,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import type { EventSubscriberDefinition } from "../eventSubscriber.types";

const aggregateType = createTestAggregateType();
const tenantId = createTestTenantId();
const readContext = createTestEventStoreReadContext(tenantId);

function makeRouter(subscriber: EventSubscriberDefinition<Event>) {
  // A QueueManager with no global queue leaves `hasSubscriberQueues()` false,
  // so the router runs the subscriber inline — the seam still applies the
  // enqueue filter, and the handler sees the staged payload.
  const queueManager = new QueueManager<Event>({
    aggregateType,
    pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
  });
  const router = new ProjectionRouter<Event>(
    aggregateType,
    TEST_CONSTANTS.PIPELINE_NAME,
    queueManager,
  );
  router.registerEventSubscriber(subscriber);
  return router;
}

function makeEvent(id: string): Event {
  return createTestEvent(
    TEST_CONSTANTS.AGGREGATE_ID,
    aggregateType,
    tenantId,
    TEST_CONSTANTS.EVENT_TYPE_1,
    1000,
    "2025-12-17",
    { marker: id },
    id,
  );
}

async function enqueueOutcomeCount(outcome: string): Promise<number> {
  const metric = register.getSingleMetric("es_subscriber_enqueue_total");
  if (!metric) return 0;
  const snapshot = (await metric.get()) as {
    values: Array<{ labels: Record<string, string>; value: number }>;
  };
  return snapshot.values
    .filter(
      (v) =>
        v.labels.subscriber_name === "seamSubscriber" &&
        v.labels.outcome === outcome,
    )
    .reduce((sum, v) => sum + v.value, 0);
}

describe("subscriber enqueue-time contract", () => {
  describe("given a subscriber with an enqueue filter", () => {
    describe("when the filter rejects the event", () => {
      /** @scenario a non-matching event never mints a job */
      it("never mints a job and counts it as filtered", async () => {
        const received: unknown[] = [];
        const before = await enqueueOutcomeCount("filtered");
        const router = makeRouter({
          name: "seamSubscriber",
          eventTypes: [],
          handle: async (event) => {
            received.push(event);
          },
          options: { enqueue: { filter: () => false } },
        });

        await router.dispatch([makeEvent("evt-filtered")], readContext);

        expect(received).toHaveLength(0);
        expect(await enqueueOutcomeCount("filtered")).toBe(before + 1);
      });
    });

    describe("when the filter throws", () => {
      /** @scenario a throwing enqueue filter surfaces into retry, never a silent drop */
      it("fails loudly into the routing retry rather than dropping silently", async () => {
        const router = makeRouter({
          name: "seamSubscriber",
          eventTypes: [],
          handle: async () => undefined,
          options: {
            enqueue: {
              filter: () => {
                throw new Error("filter blew up");
              },
            },
          },
        });

        await expect(
          router.dispatch([makeEvent("evt-throw")], readContext),
        ).rejects.toThrow();
      });
    });
  });

  describe("given a subscriber with no enqueue filter", () => {
    describe("when the event is staged", () => {
      /** @scenario enqueue outcomes are visible to operators */
      it("stages the full event unchanged and counts it as staged", async () => {
        const received: unknown[] = [];
        const before = await enqueueOutcomeCount("staged");
        const event = makeEvent("evt-full");
        const router = makeRouter({
          name: "seamSubscriber",
          eventTypes: [],
          handle: async (received_) => {
            received.push(received_);
          },
        });

        await router.dispatch([event], readContext);

        expect(received).toHaveLength(1);
        expect(received[0]).toEqual(event);
        expect(await enqueueOutcomeCount("staged")).toBe(before + 1);
      });
    });
  });
});
