import type { TriggerContext } from "@langwatch/eventing";
import type { TraceProcessingEvent, TraceSummaryData } from "@langwatch/trace-contract";
/**
 * @vitest-environment node
 * @unit
 * Deterministic from event+fold state; clock only restricts, so redelivery is idempotent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  defineOriginGuardedTraceSubscriber,
  passesTraceOriginGuards,
} from "../origin-guarded.subscriber.ts";
import {
  OCCURRED_AT,
  createContext,
  createFoldState,
  createOriginResolvedEvent,
  createOtlpSpan,
  createSpanReceivedEvent,
  createTopicAssignedEvent,
} from "./trace-subscriber.fixtures.ts";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

function makeGuardedSubscriber(options: { isRelevant?: (event: TraceProcessingEvent) => boolean }) {
  const ran: string[] = [];
  const subscriber = defineOriginGuardedTraceSubscriber({
    name: "test-subscriber",
    isRelevant: options.isRelevant,
    handler: async (event) => {
      ran.push(event.id);
    },
  });
  return { ran, subscriber };
}

const event = createSpanReceivedEvent(createOtlpSpan());
const foldState = createFoldState();

function guardedContext(state: TraceSummaryData): TriggerContext<TraceSummaryData> {
  return createContext(state);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(OCCURRED_AT));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("given an origin-guarded subscriber", () => {
  describe("when the same event is handled twice inside the guard window", () => {
    it("runs the wrapped body both times, with the same decision", async () => {
      const { ran, subscriber } = makeGuardedSubscriber({});

      await subscriber.spec.handler(event, guardedContext(foldState));
      vi.setSystemTime(new Date(OCCURRED_AT + 30 * 60 * 1000));
      await subscriber.spec.handler(event, guardedContext(foldState));

      expect(ran).toEqual([event.id, event.id]);
    });

    it("answers the same for the pre-enqueue guard as for the handler", () => {
      expect(passesTraceOriginGuards(event, foldState)).toBe(true);
      vi.setSystemTime(new Date(OCCURRED_AT + 30 * 60 * 1000));
      expect(passesTraceOriginGuards(event, foldState)).toBe(true);
    });
  });

  describe("when the redelivery arrives past the stale-event threshold", () => {
    /**
     * One-way: a redelivery an hour late is declined rather than run with
     * different inputs. This is what bounds a resync flood — a re-emitted
     * backlog cannot re-run every alert over historical traces.
     */
    it("declines the wrapped body", async () => {
      const { ran, subscriber } = makeGuardedSubscriber({});

      await subscriber.spec.handler(event, guardedContext(foldState));
      vi.setSystemTime(new Date(OCCURRED_AT + ONE_HOUR_MS + 1_000));
      await subscriber.spec.handler(event, guardedContext(foldState));

      expect(ran).toEqual([event.id]);
    });
  });

  describe("when the trace itself has aged past the trace-age bound", () => {
    it("declines the wrapped body even for a fresh event", async () => {
      const { ran, subscriber } = makeGuardedSubscriber({});
      const oldTrace = createFoldState({ occurredAt: OCCURRED_AT - ONE_DAY_MS - 1_000 });

      await subscriber.spec.handler(event, guardedContext(oldTrace));

      expect(ran).toEqual([]);
    });
  });

  describe("when a derived event is redelivered", () => {
    /**
     * Only span arrivals and origin resolution re-run side effects — without
     * this, one redelivery of the daily topic-clustering pass would fan
     * every monitor out over the whole backlog.
     */
    it("declines it however many times it arrives", async () => {
      const { ran, subscriber } = makeGuardedSubscriber({});
      const derived = createTopicAssignedEvent();

      await subscriber.spec.handler(derived, guardedContext(foldState));
      await subscriber.spec.handler(derived, guardedContext(foldState));

      expect(ran).toEqual([]);
    });
  });

  describe("when the caller's own relevance guard throws", () => {
    /**
     * Fails OPEN, deliberately (ADR-026): a throwing guard costs one
     * redundant run, never a dropped side effect — safe only because the
     * wrapped subscribers are idempotent.
     */
    it("runs the body anyway, on every delivery", async () => {
      const { ran, subscriber } = makeGuardedSubscriber({
        isRelevant: () => {
          throw new Error("guard exploded");
        },
      });

      await subscriber.spec.handler(event, guardedContext(foldState));
      await subscriber.spec.handler(event, guardedContext(foldState));

      expect(ran).toEqual([event.id, event.id]);
    });
  });

  describe("when the trace has no resolved origin", () => {
    it("declines until the origin lands, then runs", async () => {
      const { ran, subscriber } = makeGuardedSubscriber({});
      const unresolved = createFoldState({ attributes: {} });

      await subscriber.spec.handler(event, guardedContext(unresolved));
      expect(ran).toEqual([]);

      await subscriber.spec.handler(createOriginResolvedEvent(), guardedContext(foldState));
      expect(ran).toHaveLength(1);
    });
  });
});
