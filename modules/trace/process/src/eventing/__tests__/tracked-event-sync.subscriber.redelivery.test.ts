import type { OtlpKeyValue, OtlpSpan } from "@langwatch/trace-contract";
/**
 * @vitest-environment node
 * @unit
 * Event ID hashed from trace, span, event type, ordinal — deterministic, so redelivery repeats.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type TrackedEventSyncSubscriberDeps,
  createTrackedEventSyncHandler,
} from "../tracked-event-sync.subscriber.ts";
import {
  createContext,
  createFoldState,
  createSpanReceivedEvent,
  OCCURRED_AT,
} from "./trace-subscriber.fixtures.ts";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const ONE_HOUR_MS = 60 * 60 * 1000;

type Recorded = Parameters<TrackedEventSyncSubscriberDeps["recordTrackedEvent"]>[0];

function makeTrackedEventSink() {
  const recorded: Recorded[] = [];
  return {
    recorded,
    deps: {
      recordTrackedEvent: async (input: Recorded) => {
        recorded.push(input);
      },
    } satisfies TrackedEventSyncSubscriberDeps,
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

/** Attributes: event.type + metric/detail (not JSON like eval channel).
 * Missing event.type → dropped. */
function feedbackAttributes(payload: FeedbackPayload): OtlpKeyValue[] {
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
function spanWithEvents(events: { name: string; attributes: OtlpKeyValue[] }[]): OtlpSpan {
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
  };
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
    let sink: ReturnType<typeof makeTrackedEventSink>;
    let handler: ReturnType<typeof createTrackedEventSyncHandler>;
    let event: ReturnType<typeof createSpanReceivedEvent>;

    beforeEach(() => {
      sink = makeTrackedEventSink();
      handler = createTrackedEventSyncHandler(sink.deps);
      event = createSpanReceivedEvent(feedbackSpan([thumbsUp]));
    });

    it("records one tracked-event identity across both deliveries", async () => {
      await handler(event, createContext(createFoldState()));
      await handler(event, createContext(createFoldState()));

      expect(sink.recorded).toHaveLength(2);
      expect(sink.identities().size).toBe(1);
    });

    it("records the identical body both times", async () => {
      await handler(event, createContext(createFoldState()));
      await handler(event, createContext(createFoldState()));

      const [first, second] = sink.recorded;
      expect(second).toEqual(first);
      expect(first?.body.timestamp).toBe(event.occurredAt);
    });

    it("keeps the identity when the redelivery is half an hour later", async () => {
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
  let sink: ReturnType<typeof makeTrackedEventSink>;
  let handler: ReturnType<typeof createTrackedEventSyncHandler>;
  let event: ReturnType<typeof createSpanReceivedEvent>;

  beforeEach(() => {
    sink = makeTrackedEventSink();
    handler = createTrackedEventSyncHandler(sink.deps);
    event = createSpanReceivedEvent(
      feedbackSpan([thumbsUp, { ...thumbsUp, metrics: { vote: -1 } }]),
    );
  });

  it("separates them, so one delivery does not collapse two real votes", async () => {
    await handler(event, createContext(createFoldState()));

    expect(sink.identities().size).toBe(2);
  });

  it("gives each of them the same identity again on a redelivery", async () => {
    await handler(event, createContext(createFoldState()));
    await handler(event, createContext(createFoldState()));

    expect(sink.recorded).toHaveLength(4);
    expect(sink.identities().size).toBe(2);
  });
});

describe("given a span whose feedback sits behind an unrelated span event", () => {
  /**
   * The ordinal reads `span.events`, so a skipped event still occupies its
   * position. This pins that the position never moves BETWEEN deliveries —
   * the same span yields the same id however its events are laid out.
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
