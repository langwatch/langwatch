import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/metrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/metrics")>();
  return {
    ...actual,
    incrementEsReactorTotal: vi.fn(),
    incrementEsFoldProjectionTotal: vi.fn(),
    observeEsFoldProjectionDuration: vi.fn(),
    incrementEsFoldRefoldTotal: vi.fn(),
  };
});

import type { Event } from "../../domain/types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
import {
  createMockFoldProjectionDefinition,
  createMockFoldProjectionStore,
  createMockQueueManager,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import { ProjectionRouter } from "../projectionRouter";

/**
 * A reactor's `makeJobId` is its collapse key: the queue dedups on it, so N
 * sends carrying one job id leave exactly one job behind. These pin the router
 * to reaching that same queue state without paying N serialize+gzip+blob
 * round-trips per drained batch (2026-07-09 incident; see
 * specs/event-sourcing/hot-trace-fold-amplification.feature).
 */
describe("ProjectionRouter reactor dispatch over a coalesced batch", () => {
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
   * Registers the reactor, drives one coalesced batch through the fold queue's
   * batch callback, and returns the payloads the reactor's queue received.
   */
  async function dispatchBatch(
    reactor: ReactorDefinition<Event>,
    events: Event[],
  ): Promise<Array<{ event: Event; foldState: unknown }>> {
    const send = vi.fn().mockResolvedValue(undefined);
    const queueManager = createMockQueueManager({
      hasReactorQueues: true,
      getReactorQueue: vi.fn().mockReturnValue({ send }),
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
    router.registerReactor("counter", reactor);
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

  describe("when the reactor's deduplication id is the same for every event", () => {
    /** @scenario "Reactors keyed on the aggregate are dispatched once per coalesced batch" */
    it("dispatches once, with the last event in occurredAt order", async () => {
      const reactor: ReactorDefinition<Event> = {
        name: "traceUpdateBroadcast",
        options: {
          makeJobId: ({ event }) => `trace-update:${event.aggregateId}`,
        },
        handle: vi.fn().mockResolvedValue(undefined),
      };

      const payloads = await dispatchBatch(reactor, batch());

      expect(payloads).toHaveLength(1);
      expect(payloads[0]?.event.id).toBe(`event-${BATCH_SIZE - 1}`);
    });
  });

  describe("when the reactor's deduplication id includes the event id", () => {
    /** @scenario "Reactors keyed per event are still dispatched for every event" */
    it("dispatches for every event", async () => {
      const reactor: ReactorDefinition<Event> = {
        name: "customEvaluationSync",
        options: {
          makeJobId: ({ event }) => `custom-eval:${event.aggregateId}:${event.id}`,
        },
        handle: vi.fn().mockResolvedValue(undefined),
      };

      const payloads = await dispatchBatch(reactor, batch());

      expect(payloads.map((p) => p.event.id)).toEqual([
        "event-0",
        "event-1",
        "event-2",
        "event-3",
        "event-4",
      ]);
    });
  });

  describe("when the reactor declares no deduplication id", () => {
    /** @scenario "Reactors without a deduplication id are dispatched for every event" */
    it("dispatches for every event", async () => {
      const reactor: ReactorDefinition<Event> = {
        name: "undeduped",
        handle: vi.fn().mockResolvedValue(undefined),
      };

      const payloads = await dispatchBatch(reactor, batch());

      expect(payloads).toHaveLength(BATCH_SIZE);
    });
  });

  describe("when an aggregate-keyed reactor finds only some events relevant", () => {
    /** @scenario "The relevance check still filters events before collapsing" */
    it("dispatches once, with the last relevant event", async () => {
      const relevant = new Set(["event-1", "event-3"]);
      const reactor: ReactorDefinition<Event> = {
        name: "evaluationTrigger",
        shouldReact: (event) => relevant.has(event.id),
        options: {
          makeJobId: ({ event }) => `eval-trigger:${event.aggregateId}`,
        },
        handle: vi.fn().mockResolvedValue(undefined),
      };

      const payloads = await dispatchBatch(reactor, batch());

      expect(payloads).toHaveLength(1);
      // event-4 is the batch's last event, but the reactor never cared about it.
      expect(payloads[0]?.event.id).toBe("event-3");
    });
  });

  describe("when the reactor's makeJobId throws", () => {
    it("fails open and dispatches every event", async () => {
      const reactor: ReactorDefinition<Event> = {
        name: "broken",
        options: {
          makeJobId: () => {
            throw new Error("boom");
          },
        },
        handle: vi.fn().mockResolvedValue(undefined),
      };

      const payloads = await dispatchBatch(reactor, batch());

      expect(payloads).toHaveLength(BATCH_SIZE);
    });
  });
});
