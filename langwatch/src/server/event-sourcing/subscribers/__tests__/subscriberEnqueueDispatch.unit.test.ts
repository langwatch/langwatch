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
 *   - a `filter` OR a `project` that throws fails loudly into the routing
 *     retry, never a silent drop;
 *   - a `project` replaces the staged payload with its projection envelope,
 *     preserving the routing identity the scheduler orders and dedups by;
 *   - with neither hook, the full event is staged unchanged; and
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
import { isStagedProjection } from "../stagedProjection";

const aggregateType = createTestAggregateType();
const tenantId = createTestTenantId();
const readContext = createTestEventStoreReadContext(tenantId);

function makeRouter(subscriber: EventSubscriberDefinition<Event>) {
  // A QueueManager with no global queue leaves `hasSubscriberQueues()` false,
  // so the router runs the subscriber inline — the seam still applies the
  // enqueue filter/projection, and the handler sees the staged payload.
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
      /** @scenario a failed lift surfaces into retry, never a silent drop */
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

  describe("given a subscriber whose projection throws", () => {
    describe("when the slice cannot be derived", () => {
      /** @scenario a failed lift surfaces into retry, never a silent drop */
      it("fails loudly into the routing retry rather than dropping silently", async () => {
        let handlerRan = false;
        const router = makeRouter({
          name: "seamSubscriber",
          eventTypes: [],
          handle: async () => {
            handlerRan = true;
          },
          options: {
            enqueue: {
              project: () => {
                throw new Error("projection blew up");
              },
            },
          },
        });

        await expect(
          router.dispatch([makeEvent("evt-project-throw")], readContext),
        ).rejects.toThrow();
        // The event was neither staged nor silently swallowed — it surfaced.
        expect(handlerRan).toBe(false);
      });
    });
  });

  describe("given a subscriber with an enqueue projection", () => {
    describe("when the event is staged", () => {
      /**
       * @scenario a matching event's job carries the derived slice, not the raw payload
       */
      it("stages the projection envelope instead of the full event", async () => {
        const received: unknown[] = [];
        const before = await enqueueOutcomeCount("projected");
        const router = makeRouter({
          name: "seamSubscriber",
          eventTypes: [],
          handle: async (event) => {
            received.push(event);
          },
          options: {
            enqueue: { project: (event) => ({ lifted: event.id }) },
          },
        });

        await router.dispatch([makeEvent("evt-projected")], readContext);

        expect(received).toHaveLength(1);
        const staged = received[0];
        expect(isStagedProjection(staged)).toBe(true);
        expect((staged as { projection: unknown }).projection).toEqual({
          lifted: "evt-projected",
        });
        expect(await enqueueOutcomeCount("projected")).toBe(before + 1);
      });
    });

    describe("when the projection envelope is scheduled", () => {
      /**
       * Extraction changes the payload, not the delivery guarantees: the
       * envelope mirrors the exact fields the queue derives a subscriber's
       * per-aggregate group key (aggregateType:aggregateId) and score
       * (occurredAt) from, so two relevant events for one aggregate keep their
       * order, and the dedup identity is unchanged.
       *
       * @scenario extraction changes the payload, not the delivery guarantees
       */
      it("preserves the aggregate routing identity and score the scheduler orders by", async () => {
        const received: unknown[] = [];
        const event = makeEvent("evt-routing");
        const router = makeRouter({
          name: "seamSubscriber",
          eventTypes: [],
          handle: async (staged) => {
            received.push(staged);
          },
          options: { enqueue: { project: () => ({ slice: true }) } },
        });

        await router.dispatch([event], readContext);

        const staged = received[0] as {
          aggregateType: unknown;
          aggregateId: string;
          occurredAt: number;
        };
        expect(staged.aggregateType).toBe(event.aggregateType);
        expect(staged.aggregateId).toBe(String(event.aggregateId));
        expect(staged.occurredAt).toBe(event.occurredAt);
      });
    });
  });

  describe("given a subscriber with neither enqueue hook", () => {
    describe("when the event is staged", () => {
      /** @scenario enqueue outcomes are visible to operators */
      it("stages the full event unchanged and counts it as staged_full", async () => {
        const received: unknown[] = [];
        const before = await enqueueOutcomeCount("staged_full");
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
        expect(isStagedProjection(received[0])).toBe(false);
        expect(received[0]).toEqual(event);
        expect(await enqueueOutcomeCount("staged_full")).toBe(before + 1);
      });
    });
  });
});
