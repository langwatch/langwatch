/**
 * @vitest-environment node
 *
 * The enqueue-time subscriber contract (payload-cost doctrine invariant 4 —
 * ADR-069), proven at the fan-out seam. These drive the real ProjectionRouter,
 * so what a subscriber's handler receives is exactly what the seam would have
 * staged.
 *
 * Guarantees under test:
 *   - a `filter` returning false never mints a job;
 *   - a `filter` that raises is reported as a failure rather than read as a
 *     decline, loses only its own subscriber's job, and — because the routing
 *     path has no retry — is never re-dispatched (which is why the contract
 *     requires enqueue hooks to be total);
 *   - without a filter, the full event is staged unchanged; and
 *   - each outcome is counted on `es_subscriber_enqueue_total`, `staged` only
 *     once the handoff to the subscriber's lane actually succeeded.
 *
 * @see packages/group-queue/specs/payload-cost.feature
 */
import { register } from "prom-client";
import { describe, expect, it, vi } from "vitest";

import type { Event } from "../../domain/types";
import { ProjectionRouter } from "../../projections/projectionRouter";
import {
  createMockEventStore,
  createTestAggregateType,
  createTestEvent,
  createTestEventStoreReadContext,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import { EventSourcingService } from "../../services/eventSourcingService";
import { QueueManager } from "../../services/queues/queueManager";
import type { EventSubscriberDefinition } from "../eventSubscriber.types";

const aggregateType = createTestAggregateType();
const tenantId = createTestTenantId();
const readContext = createTestEventStoreReadContext(tenantId);

function makeQueueManager() {
  // A QueueManager with no global queue leaves `hasSubscriberQueues()` false,
  // so the router runs the subscriber inline — the seam still applies the
  // enqueue filter, and the handler sees the staged payload.
  return new QueueManager<Event>({
    aggregateType,
    pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
  });
}

function makeRouter(...subscribers: EventSubscriberDefinition<Event>[]) {
  const router = new ProjectionRouter<Event>(
    aggregateType,
    TEST_CONSTANTS.PIPELINE_NAME,
    makeQueueManager(),
  );
  for (const subscriber of subscribers) {
    router.registerEventSubscriber(subscriber);
  }
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

const raises = () => {
  throw new Error("filter blew up");
};

/**
 * `dispatch` reports failures as an AggregateError, so the specific cause sits
 * in `.errors`. Asserting there proves *which* failure surfaced — a bare
 * `rejects.toThrow()` would pass on any dispatch fault at all.
 */
async function expectDispatchFailure(
  dispatching: Promise<void>,
  expected: RegExp,
): Promise<Error[]> {
  const caught: unknown = await dispatching.then(
    () => null,
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(AggregateError);
  const causes = (caught as AggregateError).errors as Error[];
  // Without this the loop below vacuously passes on an empty errors array.
  expect(causes.length).toBeGreaterThan(0);
  for (const cause of causes) {
    expect(cause.message).toMatch(expected);
  }
  return causes;
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

    describe("when the filter raises", () => {
      /** @scenario a subscriber that cannot decide relevance is reported, not read as declining */
      /** @scenario work lost before it was queued is visible as lost */
      it("reports the failure and counts it as failed, so a raise is never mistaken for a decline", async () => {
        const beforeFiltered = await enqueueOutcomeCount("filtered");
        const beforeStaged = await enqueueOutcomeCount("staged");
        const beforeFailed = await enqueueOutcomeCount("failed");
        const received: unknown[] = [];
        const router = makeRouter({
          name: "seamSubscriber",
          eventTypes: [],
          handle: async (event) => {
            received.push(event);
          },
          options: { enqueue: { filter: raises } },
        });

        const causes = await expectDispatchFailure(
          router.dispatch([makeEvent("evt-throw")], readContext),
          /filter blew up/,
        );

        expect(causes).toHaveLength(1);
        expect(received).toHaveLength(0);
        // A raise is its own outcome. It must not read as a decline, and it
        // must not be silent either — the routing path has no retry, so this
        // event's job is gone and only this counter says so.
        expect(await enqueueOutcomeCount("failed")).toBe(beforeFailed + 1);
        expect(await enqueueOutcomeCount("filtered")).toBe(beforeFiltered);
        expect(await enqueueOutcomeCount("staged")).toBe(beforeStaged);
      });

      /** @scenario a subscriber that cannot decide relevance loses only its own work */
      it("still fans the event out to the other subscribers and the rest of the batch", async () => {
        const healthy: string[] = [];
        const router = makeRouter(
          {
            name: "seamSubscriber",
            eventTypes: [],
            handle: async () => undefined,
            options: { enqueue: { filter: raises } },
          },
          {
            name: "healthySubscriber",
            eventTypes: [],
            handle: async (event) => {
              healthy.push(event.id);
            },
          },
        );

        const causes = await expectDispatchFailure(
          router.dispatch(
            [makeEvent("evt-a"), makeEvent("evt-b")],
            readContext,
          ),
          /filter blew up/,
        );

        // Blast radius is one (subscriber, event) pair, not the batch: exactly
        // the raising subscriber's two pairs fail, and the healthy subscriber
        // still sees both events.
        expect(causes).toHaveLength(2);
        expect(healthy).toEqual(["evt-a", "evt-b"]);
      });

      // The honest semantics the contract states: the routing path has no
      // retry, so the reported failure is where it ends. Pinned at the
      // production caller, not just at the router boundary — a router-level
      // `rejects.toThrow()` passes even when storeEvents swallows it.
      /** @scenario a subscriber that cannot decide relevance never fails the write behind it */
      it("is swallowed by storeEvents, so the committed write succeeds and nothing re-dispatches", async () => {
        const eventStore = createMockEventStore<Event>();
        const logger = {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          fatal: vi.fn(),
          trace: vi.fn(),
          child: vi.fn().mockReturnThis(),
          level: "info",
          silent: false,
        };
        const handle = vi.fn().mockResolvedValue(void 0);
        const service = new EventSourcingService<Event>({
          pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
          aggregateType,
        allowedEventTypes: [
          TEST_CONSTANTS.EVENT_TYPE_1,
          TEST_CONSTANTS.EVENT_TYPE_2,
        ],
          eventStore,
          subscribers: [
            {
              name: "seamSubscriber",
              eventTypes: [],
              handle,
              options: { enqueue: { filter: raises } },
            },
          ],
          logger: logger as never,
        });

        await expect(
          service.storeEvents([makeEvent("evt-committed")], readContext),
        ).resolves.not.toThrow();

        // The write stands, the failure is visible to operators, and the job
        // is simply gone — there is no re-dispatch anywhere behind this.
        expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ aggregateType }),
          "Failed to dispatch events to projections",
        );
        expect(handle).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a stream of relevant and irrelevant events", () => {
    describe("when they are published together", () => {
      /** @scenario enqueue outcomes are visible to operators */
      it("moves the discarded and the queued counts independently", async () => {
        const beforeStaged = await enqueueOutcomeCount("staged");
        const beforeFiltered = await enqueueOutcomeCount("filtered");
        const handled: string[] = [];
        const router = makeRouter({
          name: "seamSubscriber",
          eventTypes: [],
          handle: async (event) => {
            handled.push(event.id);
          },
          options: {
            enqueue: {
              filter: (event) => event.id.startsWith("keep"),
            },
          },
        });

        await router.dispatch(
          [
            makeEvent("keep-1"),
            makeEvent("drop-1"),
            makeEvent("drop-2"),
            makeEvent("keep-2"),
            makeEvent("drop-3"),
          ],
          readContext,
        );

        // Both series move, by their own amounts — the distinction an operator
        // reads. One counter for both outcomes, or a filtered event counted as
        // staged, would show the seam doing work it declined to do.
        expect(await enqueueOutcomeCount("staged")).toBe(beforeStaged + 2);
        expect(await enqueueOutcomeCount("filtered")).toBe(beforeFiltered + 3);
        expect(handled).toEqual(["keep-1", "keep-2"]);
      });
    });
  });

  describe("given a subscriber with no enqueue filter", () => {
    describe("when the event is staged", () => {
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

    describe("when the subscriber's queue rejects the send", () => {
      /** @scenario work that never reaches the queue is not counted as queued */
      it("reports the failure and does not count the event as staged", async () => {
        const before = await enqueueOutcomeCount("staged");
        const queueManager = makeQueueManager();
        // Only the queue boundary is faked: the router still runs its real
        // queued branch, which is the path that can fail in production.
        vi.spyOn(queueManager, "hasSubscriberQueues").mockReturnValue(true);
        vi.spyOn(queueManager, "getSubscriberQueue").mockReturnValue({
          send: vi.fn().mockRejectedValue(new Error("queue unavailable")),
        } as never);

        const router = new ProjectionRouter<Event>(
          aggregateType,
          TEST_CONSTANTS.PIPELINE_NAME,
          queueManager,
        );
        router.registerEventSubscriber({
          name: "seamSubscriber",
          eventTypes: [],
          handle: async () => undefined,
        });

        await expectDispatchFailure(
          router.dispatch([makeEvent("evt-send-fails")], readContext),
          /queue unavailable/,
        );

        expect(await enqueueOutcomeCount("staged")).toBe(before);
      });
    });
  });

  describe("given a subscriber with a claim-check stage hook", () => {
    describe("when the hook swaps the payload for a reference", () => {
      /** @scenario relevant work waits in the queue at the cost of a pointer, not of its payload */
      it("stages the reference in place of the event and counts it as referenced", async () => {
        const received: unknown[] = [];
        const before = await enqueueOutcomeCount("referenced");
        const event = makeEvent("evt-ref");
        const router = makeRouter({
          name: "seamSubscriber",
          eventTypes: [],
          handle: async (staged) => {
            received.push(staged);
          },
          options: {
            enqueue: {
              stage: (source) => ({
                ...source,
                type: "test.referenced",
                data: { ref: source.id },
              }),
            },
          },
        });

        await router.dispatch([event], readContext);

        expect(received).toHaveLength(1);
        const staged = received[0] as {
          type: string;
          data: unknown;
          id: string;
          aggregateId: unknown;
          occurredAt: number;
        };
        expect(staged.type).toBe("test.referenced");
        expect(staged.data).toEqual({ ref: event.id });
        // The scheduling identity travels on the reference.
        expect(staged.id).toBe(event.id);
        expect(staged.aggregateId).toBe(event.aggregateId);
        expect(staged.occurredAt).toBe(event.occurredAt);
        expect(await enqueueOutcomeCount("referenced")).toBe(before + 1);
      });
    });

    describe("when the hook returns the event unchanged", () => {
      /** @scenario an event whose payload cannot be pointed at is still processed */
      it("stages the full event and counts it as staged, not referenced", async () => {
        const received: unknown[] = [];
        const beforeStaged = await enqueueOutcomeCount("staged");
        const beforeReferenced = await enqueueOutcomeCount("referenced");
        const event = makeEvent("evt-passthrough");
        const router = makeRouter({
          name: "seamSubscriber",
          eventTypes: [],
          handle: async (staged) => {
            received.push(staged);
          },
          options: { enqueue: { stage: (source) => source } },
        });

        await router.dispatch([event], readContext);

        expect(received[0]).toEqual(event);
        expect(await enqueueOutcomeCount("staged")).toBe(beforeStaged + 1);
        expect(await enqueueOutcomeCount("referenced")).toBe(beforeReferenced);
      });
    });

    describe("when the hook throws", () => {
      /** @scenario a failure preparing queued work is reported, never hidden behind the whole payload */
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
              stage: () => {
                throw new Error("stage blew up");
              },
            },
          },
        });

        await expectDispatchFailure(
          router.dispatch([makeEvent("evt-stage-throw")], readContext),
          /stage blew up/,
        );
        expect(handlerRan).toBe(false);
      });
    });
  });
});
