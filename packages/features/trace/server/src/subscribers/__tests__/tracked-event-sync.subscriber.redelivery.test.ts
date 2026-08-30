/**
 * @vitest-environment node
 * @unit
 *
 * Redelivery contract for the `trackedEventSync` subscriber, required by the
 * `eventing-subscriber-idempotency` architecture rule.
 *
 * What makes it hold: the tracked event's id is hashed from the trace id, the
 * span id, the event type and the event's ordinal WITHIN the span's own
 * `events` list. All four are fixed for a given span, so a second delivery asks
 * for the same tracked event. The recorded body's `timestamp` is the source
 * event's `occurredAt`, not a clock reading, so the recorded row is identical
 * too.
 *
 * The ordinal is the fragile half. It is the index in `span.events`, not a
 * counter over the events that happen to validate: a counter would shift
 * whenever a preceding event started or stopped passing reconstruction, and a
 * redelivery after such a change would mint a second id for one thumbs-up.
 *
 * The clock is pinned throughout, because `hasSyncableFeedback` drops any event
 * older than an hour — see the last case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTrackedEventSyncHandler } from "../tracked-event-sync.subscriber";
import {
  createContext,
  createFoldState,
  createOtlpSpan,
  createSpanReceivedEvent,
  OCCURRED_AT,
} from "./subscribers/support/trace-subscriber.fixtures";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const ONE_HOUR_MS = 60 * 60 * 1000;

type Recorded = {
  tenantId: string;
  eventId: string;
  body: { trace_id: string; event_type: string; timestamp: number };
};

function makeTrackedEventSink() {
  const recorded: Recorded[] = [];
  return {
    recorded,
    deps: {
      recordTrackedEvent: async (input: Recorded) => {
        recorded.push(input);
      },
    } as unknown as Parameters<typeof createTrackedEventSyncHandler>[0],
    /** The identity the tracked-event store collapses on. */
    identities(): Set<string> {
      return new Set(recorded.map((input) => `${input.tenantId}:${input.eventId}`));
    },
  };
}

type FeedbackPayload = {
  event_type: string;
  metrics?: Record<string, number>;
  event_details?: Record<string, string>;
};

/**
 * The attributes `recordTrackedEventSpan` actually emits for one feedback
 * event: a discrete `event.type`, and one attribute per metric and detail.
 *
 * NOT `json_encoded_event`. That is the EVALUATION channel's shape — what
 * `custom-evaluation-sync.subscriber` parses, and what the shared
 * `createOtlpSpan` helper builds. Handed a JSON blob, this subscriber's
 * `reconstructTrackedEvent` finds no `event.type`, returns undefined, and the
 * event is dropped before validation: the sink records nothing and every
 * assertion here reads zero. That is what these seven tests were doing.
 */
function feedbackAttributes(payload: FeedbackPayload) {
  return [
    { key: "event.type", value: { stringValue: payload.event_type } },
    ...Object.entries(payload.metrics ?? {}).map(([key, value]) => ({
      key: `event.metrics.${key}`,
      value: { doubleValue: value },
    })),
    ...Object.entries(payload.event_details ?? {}).map(([key, value]) => ({
      key: `event.details.${key}`,
      value: { stringValue: value },
    })),
  ];
}

/** One span carrying the given span events, in the order given. */
function spanWithEvents(events: { name: string; attributes: unknown[] }[]) {
  return {
    traceId: "aaaa0000000000000000000000000001",
    spanId: "bbbb000000000001",
    parentSpanId: null,
    name: "main",
    kind: 1,
    startTimeUnixNano: "1700000000000000000",
    endTimeUnixNano: "1700000001000000000",
    attributes: [],
    events: events.map((event) => ({
      timeUnixNano: "1700000000500000000",
      name: event.name,
      attributes: event.attributes,
    })),
    links: [],
    status: { code: null, message: null },
    flags: null,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as ReturnType<typeof createOtlpSpan>;
}

function feedbackSpan(payloads: FeedbackPayload[]) {
  return spanWithEvents(
    payloads.map((payload) => ({
      name: "langwatch.event",
      attributes: feedbackAttributes(payload),
    })),
  );
}

const thumbsUp = {
  event_type: "thumbs_up_down",
  metrics: { vote: 1 },
  event_details: { feedback: "nice" },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(OCCURRED_AT));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("given one span carrying live feedback", () => {
  describe("when the same span_received event is handled twice", () => {
    it("records one tracked-event identity across both deliveries", async () => {
      const sink = makeTrackedEventSink();
      const handler = createTrackedEventSyncHandler(sink.deps);
      const event = createSpanReceivedEvent(feedbackSpan([thumbsUp]));

      await handler(event, createContext(createFoldState()));
      await handler(event, createContext(createFoldState()));

      expect(sink.recorded).toHaveLength(2);
      expect(sink.identities().size).toBe(1);
    });

    it("records the identical body both times", async () => {
      const sink = makeTrackedEventSink();
      const handler = createTrackedEventSyncHandler(sink.deps);
      const event = createSpanReceivedEvent(feedbackSpan([thumbsUp]));

      await handler(event, createContext(createFoldState()));
      await handler(event, createContext(createFoldState()));

      const [first, second] = sink.recorded;
      expect(second).toEqual(first);
      expect(first?.body.timestamp).toBe(event.occurredAt);
    });

    it("keeps the identity when the redelivery is half an hour later", async () => {
      const sink = makeTrackedEventSink();
      const handler = createTrackedEventSyncHandler(sink.deps);
      const event = createSpanReceivedEvent(feedbackSpan([thumbsUp]));

      await handler(event, createContext(createFoldState()));
      vi.setSystemTime(new Date(OCCURRED_AT + 30 * 60 * 1000));
      await handler(event, createContext(createFoldState()));

      expect(sink.identities().size).toBe(1);
      expect(sink.recorded[1]).toEqual(sink.recorded[0]);
    });
  });

  describe("when the redelivery arrives after the staleness threshold", () => {
    it("records nothing further", async () => {
      const sink = makeTrackedEventSink();
      const handler = createTrackedEventSyncHandler(sink.deps);
      const event = createSpanReceivedEvent(feedbackSpan([thumbsUp]));

      await handler(event, createContext(createFoldState()));
      vi.setSystemTime(new Date(OCCURRED_AT + ONE_HOUR_MS + 1_000));
      await handler(event, createContext(createFoldState()));

      expect(sink.recorded).toHaveLength(1);
    });
  });
});

describe("given two feedback events of the same type on one span", () => {
  it("separates them, so one delivery does not collapse two real votes", async () => {
    const sink = makeTrackedEventSink();
    const handler = createTrackedEventSyncHandler(sink.deps);
    const event = createSpanReceivedEvent(
      feedbackSpan([thumbsUp, { ...thumbsUp, metrics: { vote: -1 } }]),
    );

    await handler(event, createContext(createFoldState()));

    expect(sink.identities().size).toBe(2);
  });

  it("gives each of them the same identity again on a redelivery", async () => {
    const sink = makeTrackedEventSink();
    const handler = createTrackedEventSyncHandler(sink.deps);
    const event = createSpanReceivedEvent(
      feedbackSpan([thumbsUp, { ...thumbsUp, metrics: { vote: -1 } }]),
    );

    await handler(event, createContext(createFoldState()));
    await handler(event, createContext(createFoldState()));

    expect(sink.recorded).toHaveLength(4);
    expect(sink.identities().size).toBe(2);
  });
});

describe("given a span whose feedback sits behind an unrelated span event", () => {
  /**
   * The ordinal reads `span.events`, so an event the reconstructor skips still
   * occupies its position. What redelivery needs is that the position does not
   * move BETWEEN deliveries of one span, which is what this pins: the same span
   * yields the same id however its events are laid out.
   */
  it("mints a stable identity across deliveries", async () => {
    const sink = makeTrackedEventSink();
    const handler = createTrackedEventSyncHandler(sink.deps);
    const event = createSpanReceivedEvent(
      spanWithEvents([
        // The evaluation channel really does carry a JSON blob, so the two
        // shapes sit on one span here exactly as they do in production.
        {
          name: "langwatch.evaluation.custom",
          attributes: [
            {
              key: "json_encoded_event",
              value: { stringValue: JSON.stringify({ name: "toxicity" }) },
            },
          ],
        },
        { name: "langwatch.event", attributes: feedbackAttributes(thumbsUp) },
      ]),
    );

    await handler(event, createContext(createFoldState()));
    await handler(event, createContext(createFoldState()));

    expect(sink.recorded).toHaveLength(2);
    expect(sink.identities().size).toBe(1);
  });
});
