/**
 * @vitest-environment node
 * @unit
 *
 * Redelivery contract for `origin-guarded.subscriber`, required by the
 * `eventing-subscriber-idempotency` architecture rule.
 *
 * This module mints no external effect of its own: it wraps a caller's handler
 * in the guard chain every origin-dependent trace subscriber shares. What has
 * to hold under redelivery is that the DECISION is a function of the event and
 * the committed fold state alone, so the second delivery of one event either
 * runs the body again with the same inputs or declines it — never a third
 * outcome. That is what makes the subscribers it wraps able to be idempotent at
 * all.
 *
 * The clock is the one input that is not carried on the event, and it is
 * one-way: the guards only ever become MORE restrictive as time passes (stale
 * events and old traces are dropped). A redelivery can therefore lose a side
 * effect it never had, but cannot gain one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TriggerContext } from "@langwatch/eventing";
import type { TraceProcessingEvent, TraceSummaryData } from "@langwatch/trace-contract";
import {
  defineOriginGuardedTraceSubscriber,
  passesTraceOriginGuards,
} from "../../src/subscribers/origin-guarded.subscriber";
import {
  createContext,
  createFoldState,
  createTraceEvent,
  OCCURRED_AT,
} from "./support/trace-subscriber.fixtures";

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

const event = createTraceEvent("lw.obs.trace.span_received");
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
     * Only span arrivals and origin resolution re-run side effects. A daily
     * topic-clustering pass re-emits `topic_assigned` for thousands of
     * historical traces; without this, one redelivery of that pass would fan
     * every monitor out over the whole backlog.
     */
    it("declines it however many times it arrives", async () => {
      const { ran, subscriber } = makeGuardedSubscriber({});
      const derived = createTraceEvent("lw.obs.trace.topic_assigned");

      await subscriber.spec.handler(derived, guardedContext(foldState));
      await subscriber.spec.handler(derived, guardedContext(foldState));

      expect(ran).toEqual([]);
    });
  });

  describe("when the caller's own relevance guard throws", () => {
    /**
     * Fails OPEN, deliberately (ADR-026): a throwing guard costs one redundant
     * run, never a dropped side effect. That is only safe BECAUSE the
     * subscribers it wraps are idempotent — which is the contract this file
     * and its siblings hold.
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

      await subscriber.spec.handler(
        createTraceEvent("lw.obs.trace.origin_resolved"),
        guardedContext(foldState),
      );
      expect(ran).toHaveLength(1);
    });
  });
});
