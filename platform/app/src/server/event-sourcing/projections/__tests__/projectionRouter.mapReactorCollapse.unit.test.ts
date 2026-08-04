import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/metrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/metrics")>();
  return {
    ...actual,
    incrementEsReactorTotal: vi.fn(),
    incrementEsReactorCollapsedTotal: vi.fn(),
    incrementEsMapProjectionTotal: vi.fn(),
    observeEsMapProjectionDuration: vi.fn(),
  };
});

import { incrementEsReactorCollapsedTotal } from "~/server/metrics";
import type { Event } from "../../domain/types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
import {
  createMockAppendStore,
  createMockMapProjectionDefinition,
  createMockQueueManager,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import { ProjectionRouter } from "../projectionRouter";

/**
 * The map batch path used to dispatch one event at a time, so the per-reactor
 * collapse never saw more than one event and could not fire. A drained batch
 * therefore staged a job per event for reactors keyed on the aggregate, and
 * the queue squashed all but the last — after every one of those sends had
 * already been serialized, gzipped and written.
 *
 * A map differs from a fold in one way that matters here: it produces a
 * separate record per event rather than one accumulated state for the batch,
 * so a survivor has to keep the record its own event produced.
 */
describe("ProjectionRouter map-reactor dispatch over a coalesced batch", () => {
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
   * Drives one coalesced batch through the map queue's batch callback and
   * returns the payloads the reactor's queue received. Each event maps to a
   * record naming it, so a payload's record identifies the event it was
   * paired with.
   */
  async function dispatchMapBatch(
    reactor: ReactorDefinition<Event>,
    events: Event[],
    map: (event: Event) => unknown = (event) => ({
      recordFor: event.id,
    }),
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

    const mapProj = createMockMapProjectionDefinition("spans", {
      store: createMockAppendStore<Record<string, unknown>>(),
      eventTypes: [],
      map,
    });

    router.registerMapProjection(mapProj);
    router.registerMapReactor("spans", reactor);
    router.initializeMapQueues();

    const initialize = queueManager.initializeHandlerQueues as ReturnType<
      typeof vi.fn
    >;
    const handlerDefs = initialize.mock.calls[0]?.[0] as Record<
      string,
      { handler: { handleBatch: (events: Event[]) => Promise<void> } }
    >;

    await handlerDefs.spans!.handler.handleBatch(events);

    return send.mock.calls.map(([payload]) => payload);
  }

  describe("when the reactor's deduplication id is the same for every event", () => {
    it("dispatches once, with the last event in occurredAt order", async () => {
      const reactor: ReactorDefinition<Event> = {
        name: "spanStorageBroadcast",
        options: {
          makeJobId: (payload) =>
            `span-stored:${payload.event.tenantId}:${payload.event.aggregateId}`,
        },
        handle: vi.fn().mockResolvedValue(undefined),
      };

      const payloads = await dispatchMapBatch(reactor, batch());

      expect(payloads).toHaveLength(1);
      expect(payloads[0]!.event.id).toBe(`event-${BATCH_SIZE - 1}`);
    });

    it("keeps the record the surviving event produced", async () => {
      const reactor: ReactorDefinition<Event> = {
        name: "spanStorageBroadcast",
        options: {
          makeJobId: (payload) => `span-stored:${payload.event.aggregateId}`,
        },
        handle: vi.fn().mockResolvedValue(undefined),
      };

      const payloads = await dispatchMapBatch(reactor, batch());

      // Not the first event's record, and not some single record standing in
      // for the whole batch — the one belonging to the event that survived.
      expect(payloads[0]!.foldState).toEqual({
        recordFor: `event-${BATCH_SIZE - 1}`,
      });
    });

    it("counts the sends it avoided", async () => {
      const reactor: ReactorDefinition<Event> = {
        name: "spanStorageBroadcast",
        options: {
          makeJobId: (payload) => `span-stored:${payload.event.aggregateId}`,
        },
        handle: vi.fn().mockResolvedValue(undefined),
      };

      await dispatchMapBatch(reactor, batch());

      expect(incrementEsReactorCollapsedTotal).toHaveBeenCalledWith(
        TEST_CONSTANTS.PIPELINE_NAME,
        "spanStorageBroadcast",
        BATCH_SIZE - 1,
      );
    });
  });

  describe("when the reactor's deduplication id varies per event", () => {
    it("dispatches every event, each with its own record", async () => {
      const reactor: ReactorDefinition<Event> = {
        name: "perEvent",
        options: {
          makeJobId: (payload) => `per-event:${payload.event.id}`,
        },
        handle: vi.fn().mockResolvedValue(undefined),
      };

      const payloads = await dispatchMapBatch(reactor, batch());

      expect(payloads).toHaveLength(BATCH_SIZE);
      expect(payloads.map((p) => p.foldState)).toEqual(
        payloads.map((p) => ({ recordFor: p.event.id })),
      );
    });
  });

  describe("when the reactor declares no deduplication id", () => {
    it("dispatches every event", async () => {
      const reactor: ReactorDefinition<Event> = {
        name: "unkeyed",
        handle: vi.fn().mockResolvedValue(undefined),
      };

      const payloads = await dispatchMapBatch(reactor, batch());

      expect(payloads).toHaveLength(BATCH_SIZE);
    });
  });

  describe("when a shouldReact predicate filters part of the batch", () => {
    it("reads each event's own record", async () => {
      const seen: unknown[] = [];
      const reactor: ReactorDefinition<Event> = {
        name: "picky",
        shouldReact: (_event, context) => {
          seen.push(context.foldState);
          return true;
        },
        handle: vi.fn().mockResolvedValue(undefined),
      };

      await dispatchMapBatch(reactor, batch());

      expect(seen).toEqual(batch().map((event) => ({ recordFor: event.id })));
    });

    it("collapses only what survived the predicate", async () => {
      const reactor: ReactorDefinition<Event> = {
        name: "picky",
        shouldReact: (event) => event.id !== `event-${BATCH_SIZE - 1}`,
        options: {
          makeJobId: (payload) => `picky:${payload.event.aggregateId}`,
        },
        handle: vi.fn().mockResolvedValue(undefined),
      };

      const payloads = await dispatchMapBatch(reactor, batch());

      // The batch's last event was filtered, so the survivor is the last
      // RELEVANT one — and it still carries its own record.
      expect(payloads).toHaveLength(1);
      expect(payloads[0]!.event.id).toBe(`event-${BATCH_SIZE - 2}`);
      expect(payloads[0]!.foldState).toEqual({
        recordFor: `event-${BATCH_SIZE - 2}`,
      });
    });
  });

  describe("when the projection maps some events to nothing", () => {
    it("dispatches only for events that produced a record", async () => {
      const reactor: ReactorDefinition<Event> = {
        name: "perEvent",
        options: {
          makeJobId: (payload) => `per-event:${payload.event.id}`,
        },
        handle: vi.fn().mockResolvedValue(undefined),
      };

      const payloads = await dispatchMapBatch(reactor, batch(), (event) =>
        event.id === "event-0" || event.id === "event-1"
          ? { recordFor: event.id }
          : null,
      );

      expect(payloads.map((p) => p.event.id)).toEqual(["event-0", "event-1"]);
    });
  });
});
