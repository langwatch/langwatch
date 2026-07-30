/**
 * @vitest-environment node
 *
 * The subscriber fan-out HAND-OFF: the step between "this event is relevant to
 * this subscriber" and "the subscriber's queue has the job".
 *
 * Retiring the reactor (ADR-098) moved every post-event handler onto this seam.
 * A reactor's hand-off used to run inside the fold's queued job, so a failed
 * send failed that job and the queue redelivered it. Subscribers fan out from
 * `EventSourcingService.storeEvents`, which logs a dispatch failure and
 * continues — a committed write must not be undone by a projection fault — so
 * for one release a single unlucky `send` was permanent loss of that
 * subscriber's job, including every ADR-103 process manager, which the runtime
 * mounts as an ordinary `pm:*` subscriber.
 *
 * Three properties are pinned here, and they compose in this order:
 *
 *   1. the batch a subscriber is owed is collapsed by the queue's OWN dedup
 *      key before anything is paid for, because the queue's squash happens
 *      after the serialise + compress + blob write it would refund;
 *   2. what survives goes over in one exchange, not one per event; and
 *   3. that exchange is re-attempted on a transient failure, and re-attempted
 *      with the identical payload so the queue's staged-job id (ADR-100)
 *      recognises a landed-but-unacknowledged send as the same job.
 *
 * @see specs/event-sourcing/post-event-work.feature
 * @see specs/event-sourcing/payload-cost.feature
 * @see specs/event-sourcing/staged-job-id-identity.feature
 */
import { register } from "prom-client";
import { describe, expect, it, vi } from "vitest";

import type { Event } from "../../domain/types";
import { EventSourcedQueueProcessorMemory } from "../../queues/memory";
import {
  createMockEventStore,
  createTestAggregateType,
  createTestEvent,
  createTestEventStoreReadContext,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import { ConfigurationError } from "../../services/errorHandling";
import { EventSourcingService } from "../../services/eventSourcingService";
import type { JobRegistryEntry } from "../../services/queues/queueManager";
import { QueueManager } from "../../services/queues/queueManager";
import type { EventSubscriberDefinition } from "../../subscribers/eventSubscriber.types";
import { ProjectionRouter } from "../projectionRouter";

const aggregateType = createTestAggregateType();
const tenantId = createTestTenantId();
const readContext = createTestEventStoreReadContext(tenantId);
const SUBSCRIBER = "handoffSubscriber";

function makeEvent(id: string, data: Record<string, unknown> = {}): Event {
  return createTestEvent(
    TEST_CONSTANTS.AGGREGATE_ID,
    aggregateType,
    tenantId,
    TEST_CONSTANTS.EVENT_TYPE_1,
    1000,
    "2025-12-17",
    data,
    id,
  );
}

/**
 * A router wired to a real QueueManager whose subscriber lane is faked at the
 * queue boundary and nowhere else, so the router runs its real queued branch —
 * the one that can fail in production.
 *
 * Returns the recorded hand-offs: one entry per exchange with the queue,
 * holding the event ids that exchange carried. That is the whole observable
 * surface of the three properties — how many exchanges, and what was in each.
 *
 * The fake honours BOTH `send` and `sendBatch`, recording a single-payload
 * hand-off for the former. Without that a router that still sent per event
 * would fail these tests on a missing method rather than on the behaviour they
 * are about, and the per-event path is exactly what they exist to rule out.
 */
function makeQueuedRouter({
  subscriber,
  sendBatch,
}: {
  subscriber: EventSubscriberDefinition<Event>;
  sendBatch: (payloads: Event[]) => Promise<void>;
}) {
  const batches: string[][] = [];
  const handOff = async (payloads: Event[]) => {
    batches.push(payloads.map((payload) => payload.id));
    await sendBatch(payloads);
  };
  const queueManager = new QueueManager<Event>({
    aggregateType,
    pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
  });
  vi.spyOn(queueManager, "hasSubscriberQueues").mockReturnValue(true);
  vi.spyOn(queueManager, "getSubscriberQueue").mockReturnValue({
    send: async (payload: Event) => handOff([payload]),
    sendBatch: handOff,
  } as never);

  const router = new ProjectionRouter<Event>(
    aggregateType,
    TEST_CONSTANTS.PIPELINE_NAME,
    queueManager,
  );
  router.registerEventSubscriber(subscriber);
  return { router, batches };
}

function collapsibleSubscriber(
  makeId: (event: Event) => string,
): EventSubscriberDefinition<Event> {
  return {
    name: SUBSCRIBER,
    eventTypes: [],
    handle: async () => undefined,
    options: { deduplication: { makeId } },
  };
}

async function enqueueOutcomeCount(outcome?: string): Promise<number> {
  const metric = register.getSingleMetric("es_subscriber_enqueue_total");
  if (!metric) return 0;
  const snapshot = (await metric.get()) as {
    values: Array<{ labels: Record<string, string>; value: number }>;
  };
  return snapshot.values
    .filter(
      (v) =>
        v.labels.subscriber_name === SUBSCRIBER &&
        (outcome === undefined || v.labels.outcome === outcome),
    )
    .reduce((sum, v) => sum + v.value, 0);
}

/**
 * Every outcome this subscriber has recorded, summed.
 *
 * The documented invariant is that the outcomes sum to the events routed to a
 * subscriber, so this — not any single series — is what pins it. Summing over
 * whatever labels exist also means a future outcome cannot restore the total
 * by accident: it has to be reachable from a real dispatch to move this.
 */
const enqueueOutcomeTotal = (): Promise<number> => enqueueOutcomeCount();

describe("subscriber queue hand-off", () => {
  describe("given a queue that fails one attempt and then accepts", () => {
    describe("when an event a subscriber must see is published", () => {
      /** @scenario "A blip handing work to its queue does not lose the work" */
      it("hands the work over again rather than losing it, and counts it queued", async () => {
        const before = {
          staged: await enqueueOutcomeCount("staged"),
          failed: await enqueueOutcomeCount("failed"),
        };
        let attempts = 0;
        const { router, batches } = makeQueuedRouter({
          subscriber: {
            name: SUBSCRIBER,
            eventTypes: [],
            handle: async () => undefined,
          },
          sendBatch: async () => {
            attempts += 1;
            if (attempts === 1) throw new Error("redis blipped");
          },
        });

        await expect(
          router.dispatch([makeEvent("evt-blip")], readContext),
        ).resolves.not.toThrow();

        // The work reached the queue, and the seam reports it as queued — not
        // as the loss it used to be. Both halves matter: a retry that swallowed
        // the outcome would leave `failed` moving on a healthy pipeline.
        expect(attempts).toBe(2);
        expect(batches.at(-1)).toEqual(["evt-blip"]);
        expect(await enqueueOutcomeCount("staged")).toBe(before.staged + 1);
        expect(await enqueueOutcomeCount("failed")).toBe(before.failed);
      });

      /** @scenario "Handing the same work over twice leaves one piece of work" */
      it("re-sends the identical payload, so the queue resolves it to the job already staged", async () => {
        // The staged job id is derived from the payload (`<eventId>/<jobType>/
        // <jobName>`, ADR-100), so re-sending the SAME payload is what makes a
        // landed-but-unacknowledged send land on the member already there and
        // overwrite it, rather than staging a second job. A re-attempt that
        // rebuilt or narrowed the payload would break that.
        let attempts = 0;
        const seen: Event[][] = [];
        const { router } = makeQueuedRouter({
          subscriber: {
            name: SUBSCRIBER,
            eventTypes: [],
            handle: async () => undefined,
          },
          sendBatch: async (payloads) => {
            attempts += 1;
            seen.push(payloads);
            if (attempts === 1) throw new Error("ack lost");
          },
        });

        await router.dispatch(
          [makeEvent("evt-a"), makeEvent("evt-b")],
          readContext,
        );

        expect(seen).toHaveLength(2);
        expect(seen[1]).toEqual(seen[0]);
      });
    });
  });

  describe("given a queue that fails every attempt", () => {
    describe("when an event a subscriber must see is published", () => {
      /** @scenario "A queue that stays unavailable gives up rather than holding up the write" */
      it("stops after a bounded number of attempts and records the work as lost", async () => {
        const before = {
          staged: await enqueueOutcomeCount("staged"),
          failed: await enqueueOutcomeCount("failed"),
        };
        let attempts = 0;
        // Three events that collapse onto one payload, so the loss accounting
        // is exercised where it is easiest to get wrong: counting only what was
        // sent would report one lost job for three lost events, and the outcome
        // series is documented to account for every event routed.
        const { router } = makeQueuedRouter({
          subscriber: collapsibleSubscriber(
            (event) => `down:${String(event.aggregateId)}`,
          ),
          sendBatch: async () => {
            attempts += 1;
            throw new Error("queue unavailable");
          },
        });

        const caught: unknown = await router
          .dispatch(
            [
              makeEvent("evt-down-1"),
              makeEvent("evt-down-2"),
              makeEvent("evt-down-3"),
            ],
            readContext,
          )
          .then(
            () => null,
            (error: unknown) => error,
          );

        // Settling at all is the boundedness claim: an unbounded ladder against
        // a permanently dead queue never returns. The window is asserted as a
        // range rather than against the constant, so this fails on a ladder
        // that stopped retrying or ran away, not on a tuning change.
        expect(attempts).toBeGreaterThan(1);
        expect(attempts).toBeLessThanOrEqual(5);
        expect(caught).toBeInstanceOf(AggregateError);
        expect(await enqueueOutcomeCount("failed")).toBe(before.failed + 3);
        expect(await enqueueOutcomeCount("staged")).toBe(before.staged);
      });

      /** @scenario "A queue that stays unavailable gives up rather than holding up the write" */
      it("leaves the committed write standing when the caller is storeEvents", async () => {
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
        const service = new EventSourcingService<Event>({
          pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
          aggregateType,
          eventStore,
          subscribers: [
            {
              name: SUBSCRIBER,
              eventTypes: [],
              handle: vi.fn().mockRejectedValue(new Error("queue unavailable")),
            },
          ],
          logger: logger as never,
        });

        await expect(
          service.storeEvents([makeEvent("evt-committed")], readContext),
        ).resolves.not.toThrow();

        expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ aggregateType }),
          "Failed to dispatch events to projections",
        );
      });
    });
  });

  describe("given a hand-off that fails for a reason retrying cannot change", () => {
    describe("when the event is published", () => {
      /** @scenario "Work whose hand-off cannot succeed is not retried" */
      it("attempts it once and records the work as lost", async () => {
        // A configuration fault reproduces exactly on a second identical send.
        // Re-attempting only holds up the caller waiting on a write that has
        // already committed, so the seam defers to the queue's own retryability
        // rule rather than forming a second opinion about it.
        const before = await enqueueOutcomeCount("failed");
        let attempts = 0;
        const { router } = makeQueuedRouter({
          subscriber: {
            name: SUBSCRIBER,
            eventTypes: [],
            handle: async () => undefined,
          },
          sendBatch: async () => {
            attempts += 1;
            throw new ConfigurationError("QueueManager", "misconfigured lane");
          },
        });

        await router
          .dispatch([makeEvent("evt-critical")], readContext)
          .catch(() => undefined);

        expect(attempts).toBe(1);
        expect(await enqueueOutcomeCount("failed")).toBe(before + 1);
      });
    });
  });

  describe("given a substrate that runs the work as it is handed over", () => {
    describe("when the subscriber's own handler fails", () => {
      /** @scenario "Work that fails while running is not mistaken for a failed hand-off" */
      it("does not run the handler again, leaving the failure to the lane that retries work", async () => {
        // The in-memory processor — the no-Redis dev and test substrate, driven
        // here exactly as production wires it — resolves a send once the job has
        // been PROCESSED rather than staged. A handler's own failure therefore
        // travels back up the send, where position alone cannot tell it from a
        // rejected hand-off. Re-attempting would re-run a handler that already
        // ran, inside the caller's write path, and running work again is the
        // consumer lane's job, not the publisher's.
        const runs: string[] = [];
        const registry = new Map<string, JobRegistryEntry>();
        const globalQueue = new EventSourcedQueueProcessorMemory<
          Record<string, unknown>
        >({
          name: "handoff-test-global-queue",
          process: async (payload) => {
            const {
              __pipelineName: pipelineName,
              __jobType: jobType,
              __jobName: jobName,
              ...clean
            } = payload;
            const entry = registry.get(
              `${String(pipelineName)}:${String(jobType)}:${String(jobName)}`,
            );
            if (entry) await entry.process(clean);
          },
        });

        const service = new EventSourcingService<Event>({
          pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
          aggregateType,
          eventStore: createMockEventStore<Event>(),
          subscribers: [
            {
              name: SUBSCRIBER,
              eventTypes: [],
              handle: async (event) => {
                runs.push(event.id);
                throw new Error("handler blew up");
              },
            },
          ],
          globalQueue,
          globalJobRegistry: registry,
        });

        await service.storeEvents(
          [makeEvent("evt-handler-fails")],
          readContext,
        );

        expect(runs).toEqual(["evt-handler-fails"]);
      });
    });
  });

  describe("given a subscriber whose work collapses on the aggregate", () => {
    describe("when a burst about that aggregate is published", () => {
      /** @scenario "a burst that collapses to one piece of work is only published once" */
      it("hands the queue one piece of work while still accounting for every event", async () => {
        const before = await enqueueOutcomeTotal();
        const { router, batches } = makeQueuedRouter({
          subscriber: collapsibleSubscriber(
            (event) => `burst:${String(event.aggregateId)}`,
          ),
          sendBatch: async () => undefined,
        });

        await router.dispatch(
          [
            makeEvent("evt-1"),
            makeEvent("evt-2"),
            makeEvent("evt-3"),
            makeEvent("evt-4"),
            makeEvent("evt-5"),
          ],
          readContext,
        );

        // One exchange carrying one payload — the LAST, which is the value the
        // queue's own squash would have left behind. Five sends reaching the
        // same state is exactly the churn this collapse removes.
        expect(batches).toEqual([["evt-5"]]);
        // The collapse changes what is PAID, never what is OWED: all five
        // events are still accounted for, as they were when the queue did the
        // squashing a moment later. A dip in the TOTAL would read to an
        // operator as lost work. Which outcomes carry the five is the next
        // test's subject.
        expect(await enqueueOutcomeTotal()).toBe(before + 5);
      });

      /** @scenario "the work a collapse avoided is visible to operators" */
      it("counts the folded-away events as work avoided rather than as work queued", async () => {
        const before = {
          total: await enqueueOutcomeTotal(),
          staged: await enqueueOutcomeCount("staged"),
          collapsed: await enqueueOutcomeCount("collapsed"),
        };
        const { router, batches } = makeQueuedRouter({
          subscriber: collapsibleSubscriber(
            (event) => `saving:${String(event.aggregateId)}`,
          ),
          sendBatch: async () => undefined,
        });

        await router.dispatch(
          [
            makeEvent("evt-s1"),
            makeEvent("evt-s2"),
            makeEvent("evt-s3"),
            makeEvent("evt-s4"),
            makeEvent("evt-s5"),
          ],
          readContext,
        );

        expect(batches).toEqual([["evt-s5"]]);
        // The exact split is the point. `staged` counts the payload that was
        // actually serialised, compressed and handed over — one — so it now
        // means what a dashboard reader assumes it means. The four events
        // whose payloads were never built count `collapsed`, which is the
        // saving made legible: it is the only series that moves when the
        // collapse works, and the only one that stops moving if a change
        // silently disables it.
        expect(await enqueueOutcomeCount("staged")).toBe(before.staged + 1);
        expect(await enqueueOutcomeCount("collapsed")).toBe(
          before.collapsed + 4,
        );
        // Instead of, never in addition to: counting a folded-away event as
        // both would make the outcomes sum to nine for five routed events and
        // quietly break `failed`'s denominator.
        expect(await enqueueOutcomeTotal()).toBe(before.total + 5);
      });
    });

    describe("when the burst spans more than one collapse window", () => {
      /** @scenario "events that collapse to different pieces of work are all published" */
      it("hands the queue each window's work, in the order the events arrived", async () => {
        const { router, batches } = makeQueuedRouter({
          subscriber: collapsibleSubscriber(
            (event) =>
              `window:${String((event.data as { window: string }).window)}`,
          ),
          sendBatch: async () => undefined,
        });

        await router.dispatch(
          [
            makeEvent("evt-a1", { window: "a" }),
            makeEvent("evt-b1", { window: "b" }),
            makeEvent("evt-a2", { window: "a" }),
            makeEvent("evt-b2", { window: "b" }),
          ],
          readContext,
        );

        // Two survivors, each its window's last, and still in arrival order —
        // keeping only a map's values would have ordered them by each window's
        // FIRST event while holding its last, sending a later event first.
        expect(batches).toEqual([["evt-a2", "evt-b2"]]);
      });
    });
  });

  describe("given a subscriber whose work carries no collapse window", () => {
    describe("when several events it cares about are published", () => {
      /** @scenario "work that collapses to nothing is published for every event, in one exchange" */
      it("hands every event's work over in a single exchange", async () => {
        const { router, batches } = makeQueuedRouter({
          subscriber: {
            name: SUBSCRIBER,
            eventTypes: [],
            handle: async () => undefined,
          },
          sendBatch: async () => undefined,
        });

        await router.dispatch(
          [makeEvent("evt-x"), makeEvent("evt-y"), makeEvent("evt-z")],
          readContext,
        );

        // Nothing is collapsed — without a dedup key every event is its own
        // job — but the three still cost ONE round trip rather than three
        // serialized ones, which is what every sibling dispatch lane already
        // does with `sendBatch`.
        expect(batches).toEqual([["evt-x", "evt-y", "evt-z"]]);
      });
    });
  });

  describe("given a subscriber whose collapse key throws", () => {
    describe("when a burst it cares about is published", () => {
      /** @scenario "a subscriber that cannot decide what its work collapses to publishes everything" */
      it("fails open and hands every event's work to the queue", async () => {
        const before = await enqueueOutcomeCount("failed");
        const { router, batches } = makeQueuedRouter({
          subscriber: collapsibleSubscriber(() => {
            throw new Error("key blew up");
          }),
          sendBatch: async () => undefined,
        });

        await expect(
          router.dispatch(
            [makeEvent("evt-p"), makeEvent("evt-q"), makeEvent("evt-r")],
            readContext,
          ),
        ).resolves.not.toThrow();

        // Failing open costs an un-collapsed fan-out; failing closed would cost
        // the events themselves. The key function is therefore allowed to throw
        // where the enqueue hooks are not.
        expect(batches).toEqual([["evt-p", "evt-q", "evt-r"]]);
        expect(await enqueueOutcomeCount("failed")).toBe(before);
      });
    });
  });
});
