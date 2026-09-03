import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../metrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../metrics")>();
  return {
    ...actual,
    incrementEsReactorTotal: vi.fn(),
    incrementEsReactorCollapsedTotal: vi.fn(),
    incrementEsFoldProjectionTotal: vi.fn(),
    observeEsFoldProjectionDuration: vi.fn(),
    incrementEsFoldRefoldTotal: vi.fn(),
  };
});

import type { Event } from "../../domain/types";
import {
  createMockFoldProjectionDefinition,
  createMockFoldProjectionStore,
  createMockQueueManager,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import type { SubscriberDispatchDefinition } from "../../subscribers/subscriber.types";
import { ProjectionRouter } from "../projectionRouter";

/**
 * A subscriber's `makeJobId` is its collapse key: the queue dedups on it, so N
 * sends carrying one job id leave exactly one job behind. These pin the router
 * to reaching that same queue state without paying N serialize+gzip+blob
 * round-trips per drained batch (2026-07-09 incident; see
 * specs/trace-processing/hot-trace-fold-amplification.feature).
 */
describe("ProjectionRouter subscriber dispatch over a coalesced batch", () => {
  const tenantId = createTestTenantId();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const BATCH_SIZE = 5;

  /** Five events for one aggregate, already in occurredAt order. */
  const batch = (): Event[] =>
    Array.from({ length: BATCH_SIZE }, (_, i) =>
      createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        undefined,
        1_000 + i,
        undefined,
        undefined,
        `event-${i}`,
      ),
    );

  /**
   * Registers the subscriber, drives one coalesced batch through the fold queue's
   * batch callback, and returns the payloads the subscriber's queue received.
   */
  async function dispatchBatch(
    subscriber: SubscriberDispatchDefinition<Event>,
    events: Event[],
  ): Promise<Array<{ event: Event; foldState: unknown }>> {
    const send = vi.fn().mockResolvedValue(undefined);
    const queueManager = createMockQueueManager({
      hasProjectionSubscriberQueues: true,
      getProjectionSubscriberQueue: vi.fn().mockReturnValue({ send }),
    });

    const router = new ProjectionRouter<Event>(
      TEST_CONSTANTS.AGGREGATE_TYPE,
      TEST_CONSTANTS.PIPELINE_NAME,
      queueManager,
    );

    const store = createMockFoldProjectionStore<{ count: number }>();
    (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const fold = createMockFoldProjectionDefinition("counter", {
      store,
      init: () => ({ count: 0 }),
      apply: (state: { count: number }) => ({ count: state.count + 1 }),
    });

    router.registerFoldProjection(fold);
    router.registerSubscriber("counter", subscriber);
    router.initializeFoldQueues();

    const initialize = queueManager.initializeProjectionQueues as ReturnType<
      typeof vi.fn
    >;
    const onEventBatch = initialize.mock.calls[0]?.[2] as (
      projectionName: string,
      events: Event[],
      context: unknown,
    ) => Promise<void>;

    await onEventBatch("counter", events, { tenantId });

    return send.mock.calls.map(([payload]) => payload);
  }

  describe("when the subscriber's deduplication id is the same for every event", () => {
    /** @scenario "Subscribers keyed on the aggregate are dispatched once per coalesced batch" */
    it("dispatches once, with the last event in occurredAt order", async () => {
      const subscriber: SubscriberDispatchDefinition<Event> = {
        name: "traceUpdateBroadcast",
        options: {
          makeJobId: ({ event }) => `trace-update:${event.aggregateId}`,
        },
        handle: vi.fn().mockResolvedValue(undefined),
      };

      const payloads = await dispatchBatch(subscriber, batch());

      expect(payloads).toHaveLength(1);
      expect(payloads[0]?.event.id).toBe(`event-${BATCH_SIZE - 1}`);
    });
  });

  describe("when the subscriber's deduplication id includes the event id", () => {
    /** @scenario "Subscribers keyed per event are still dispatched for every event" */
    it("dispatches for every event", async () => {
      const subscriber: SubscriberDispatchDefinition<Event> = {
        name: "customEvaluationSync",
        options: {
          makeJobId: ({ event }) => `custom-eval:${event.aggregateId}:${event.id}`,
        },
        handle: vi.fn().mockResolvedValue(undefined),
      };

      const payloads = await dispatchBatch(subscriber, batch());

      expect(payloads.map((p) => p.event.id)).toEqual([
        "event-0",
        "event-1",
        "event-2",
        "event-3",
        "event-4",
      ]);
    });
  });

  describe("when the subscriber declares no deduplication id", () => {
    /** @scenario "Subscribers without a deduplication id are dispatched for every event" */
    it("dispatches for every event", async () => {
      const subscriber: SubscriberDispatchDefinition<Event> = {
        name: "undeduped",
        handle: vi.fn().mockResolvedValue(undefined),
      };

      const payloads = await dispatchBatch(subscriber, batch());

      expect(payloads).toHaveLength(BATCH_SIZE);
    });
  });

  describe("when an aggregate-keyed subscriber finds only some events relevant", () => {
    /** @scenario "The relevance check still filters events before collapsing" */
    it("dispatches once, with the last relevant event", async () => {
      const relevant = new Set(["event-1", "event-3"]);
      const subscriber: SubscriberDispatchDefinition<Event> = {
        name: "evaluationTrigger",
        shouldDispatch: (event) => relevant.has(event.id),
        options: {
          makeJobId: ({ event }) => `eval-trigger:${event.aggregateId}`,
        },
        handle: vi.fn().mockResolvedValue(undefined),
      };

      const payloads = await dispatchBatch(subscriber, batch());

      expect(payloads).toHaveLength(1);
      // event-4 is the batch's last event, but the subscriber never cared about it.
      expect(payloads[0]?.event.id).toBe("event-3");
    });
  });

  describe("when the subscriber's makeJobId throws", () => {
    it("fails open and dispatches every event", async () => {
      const subscriber: SubscriberDispatchDefinition<Event> = {
        name: "broken",
        options: {
          makeJobId: () => {
            throw new Error("boom");
          },
        },
        handle: vi.fn().mockResolvedValue(undefined),
      };

      const payloads = await dispatchBatch(subscriber, batch());

      expect(payloads).toHaveLength(BATCH_SIZE);
    });
  });
  describe("when one batch carries two distinct deduplication ids", () => {
    it("dispatches each survivor in the occurredAt order of the event it carries", async () => {
      // job A is seen at event-0 and again at event-4; job B only at event-1.
      // A Map alone would order survivors by FIRST occurrence — [A(event-4),
      // B(event-1)] — dispatching a later event before an earlier one.
      const jobFor: Record<string, string> = {
        "event-0": "A",
        "event-1": "B",
        "event-2": "A",
        "event-3": "B",
        "event-4": "A",
      };
      const subscriber: SubscriberDispatchDefinition<Event> = {
        name: "two-lane",
        options: {
          // Every id is in the map.
          makeJobId: ({ event }) => jobFor[event.id]!,
        },
        handle: vi.fn().mockResolvedValue(undefined),
      };

      const payloads = await dispatchBatch(subscriber, batch());

      // Survivors: B's last is event-3, A's last is event-4 → occurredAt order.
      expect(payloads.map((p) => p.event.id)).toEqual(["event-3", "event-4"]);
    });
  });
});
