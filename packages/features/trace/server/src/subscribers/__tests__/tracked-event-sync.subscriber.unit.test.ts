import type { TriggerContext } from "@langwatch/eventing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import { TRACK_EVENT_SPAN_NAME } from "@langwatch/trace-contract";
import type { SpanReceivedEvent, TraceProcessingEvent } from "@langwatch/trace-contract";
import type { OtlpSpan } from "@langwatch/trace-contract";
import {
  TrackedEventSync,
  type TrackedEventSyncSubscriberDeps,
} from "../tracked-event-sync.subscriber";

type FeedbackEvent = {
  type?: string;
  metrics?: Record<string, number>;
  /** Metrics sent the way OTLP encodes an integer, rather than as a double. */
  intMetrics?: Record<string, number | string | { low: number; high: number }>;
  details?: Record<string, string>;
};

function makeOtlpSpan(feedbackEvents: FeedbackEvent[]): OtlpSpan {
  return {
    traceId: "aaaa0000000000000000000000000001",
    spanId: "bbbb000000000001",
    parentSpanId: null,
    name: "main",
    kind: 1,
    startTimeUnixNano: "1700000000000000000",
    endTimeUnixNano: "1700000001000000000",
    attributes: [],
    events: feedbackEvents.map((feedback) => ({
      timeUnixNano: "1700000000500000000",
      name: "langwatch.event",
      attributes: [
        ...(feedback.type !== undefined
          ? [{ key: "event.type", value: { stringValue: feedback.type } }]
          : []),
        ...Object.entries(feedback.metrics ?? {}).map(([key, value]) => ({
          key: `event.metrics.${key}`,
          value: { doubleValue: value },
        })),
        ...Object.entries(feedback.intMetrics ?? {}).map(([key, value]) => ({
          key: `event.metrics.${key}`,
          value: { intValue: value },
        })),
        ...Object.entries(feedback.details ?? {}).map(([key, value]) => ({
          key: `event.details.${key}`,
          value: { stringValue: value },
        })),
      ],
    })),
    links: [],
    status: { code: null, message: null },
    flags: null,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as OtlpSpan;
}

/**
 * Mirrors the span `recordTrackedEventSpan` ingests back into the same
 * trace-processing pipeline: named `TRACK_EVENT_SPAN_NAME`, carrying one span
 * event named after the recorded event type, whose attributes always include
 * `event.type`. With `eventType` set to `langwatch.event` this span is
 * byte-for-byte the shape this subscriber reacts to, which is the
 * amplification loop.
 */
function makeRecordedTrackEventSpan(eventType: string): OtlpSpan {
  const attributes = [
    { key: "event.type", value: { stringValue: eventType } },
    { key: "event.id", value: { stringValue: "event_sha_deadbeef" } },
    { key: "event.metrics.vote", value: { doubleValue: 1 } },
  ];

  return {
    traceId: "aaaa0000000000000000000000000001",
    spanId: "cccc000000000002",
    parentSpanId: null,
    name: TRACK_EVENT_SPAN_NAME,
    kind: 1,
    startTimeUnixNano: "1700000000500000000",
    endTimeUnixNano: "1700000000500000000",
    attributes,
    events: [{ name: eventType, timeUnixNano: "1700000000500000000", attributes }],
    links: [],
    status: { code: 1, message: null },
    flags: null,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as OtlpSpan;
}

function createFoldState(): TraceSummaryData {
  return {
    traceId: "trace-1",
    occurredAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attributes: {},
  } as unknown as TraceSummaryData;
}

function createSpanReceivedEvent(
  span: OtlpSpan,
  overrides: Partial<SpanReceivedEvent> = {},
): SpanReceivedEvent {
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.obs.trace.span_received",
    version: 1,
    data: {
      span,
      resource: null,
      instrumentationScope: null,
      piiRedactionLevel: "STRICT",
    },
    metadata: { spanId: "span-1", traceId: "trace-1" },
    ...overrides,
  } as unknown as SpanReceivedEvent;
}

function createNonSpanEvent(): TraceProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.obs.trace.topic_assigned",
    version: 1,
    data: {},
    metadata: {},
  } as unknown as TraceProcessingEvent;
}

function createContext(state: TraceSummaryData): TriggerContext<TraceSummaryData> {
  // Deliberately NOT the event's `tenant-1`: the subscriber must record against
  // the context's tenant, and identical fixtures would let a subscriber reading
  // `event.tenantId` pass just as happily.
  return {
    tenantId: "context-tenant-1",
    aggregateId: "trace-1",
    state,
  };
}

describe("extractTrackedEventsFromSpan", () => {
  describe("given a span carrying a langwatch.event feedback event", () => {
    it("reconstructs the event type, metrics, and details", () => {
      const span = makeOtlpSpan([
        {
          type: "thumbs_up_down",
          metrics: { vote: 1 },
          details: { feedback: "great answer" },
        },
      ]);

      const result = TrackedEventSync.extractTrackedEventsFromSpan(span);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        event_type: "thumbs_up_down",
        metrics: { vote: 1 },
        event_details: { feedback: "great answer" },
        occurrenceIndex: 0,
      });
    });
  });

  describe("given a metric encoded as an OTLP integer", () => {
    it("reads a plain intValue", () => {
      const span = makeOtlpSpan([{ type: "thumbs_up_down", intMetrics: { vote: 1 } }]);

      expect(TrackedEventSync.extractTrackedEventsFromSpan(span)[0]?.metrics).toEqual({
        vote: 1,
      });
    });

    it("reads a stringified intValue", () => {
      const span = makeOtlpSpan([{ type: "thumbs_up_down", intMetrics: { vote: "-1" } }]);

      expect(TrackedEventSync.extractTrackedEventsFromSpan(span)[0]?.metrics).toEqual({
        vote: -1,
      });
    });

    it("reads a protobuf Long intValue", () => {
      const span = makeOtlpSpan([
        {
          type: "waited_to_finish",
          intMetrics: { finished: { low: 1, high: 0 } },
        },
      ]);

      expect(TrackedEventSync.extractTrackedEventsFromSpan(span)[0]?.metrics).toEqual({
        finished: 1,
      });
    });
  });

  describe("given a span with no feedback events", () => {
    it("returns an empty array", () => {
      const span = makeOtlpSpan([]);

      expect(TrackedEventSync.extractTrackedEventsFromSpan(span)).toHaveLength(0);
    });
  });

  describe("given a feedback event with no event type", () => {
    it("skips the malformed event", () => {
      const span = makeOtlpSpan([{ metrics: { vote: 1 } }]);

      expect(TrackedEventSync.extractTrackedEventsFromSpan(span)).toHaveLength(0);
    });
  });

  describe("given a feedback event with only an event type", () => {
    it("reconstructs it with empty metrics and details", () => {
      const span = makeOtlpSpan([{ type: "waited_to_finish" }]);

      const result = TrackedEventSync.extractTrackedEventsFromSpan(span);

      expect(result[0]).toEqual({
        event_type: "waited_to_finish",
        metrics: {},
        event_details: {},
        occurrenceIndex: 0,
      });
    });
  });

  describe("given a span whose first feedback event is unusable", () => {
    it("numbers the reconstructed events by their position in the span", () => {
      const span = makeOtlpSpan([
        { metrics: { vote: 1 } },
        { type: "thumbs_up_down", metrics: { vote: 1 } },
      ]);

      const result = TrackedEventSync.extractTrackedEventsFromSpan(span);

      expect(result).toHaveLength(1);
      expect(result[0]?.occurrenceIndex).toBe(1);
    });
  });

  describe("given a span this ingestion path emitted itself", () => {
    it("reconstructs nothing from it", () => {
      const span = makeRecordedTrackEventSpan("langwatch.event");

      expect(TrackedEventSync.extractTrackedEventsFromSpan(span)).toHaveLength(0);
    });
  });

  describe("given a feedback event typed as the envelope name", () => {
    it("skips the reserved event type", () => {
      const span = makeOtlpSpan([{ type: "langwatch.event", metrics: { vote: 1 } }]);

      expect(TrackedEventSync.extractTrackedEventsFromSpan(span)).toHaveLength(0);
    });
  });
});

describe("trackedEventSync subscriber", () => {
  let deps: TrackedEventSyncSubscriberDeps;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now());
    deps = {
      recordTrackedEvent: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when the event is not a SpanReceivedEvent", () => {
    it("records no tracked event", async () => {
      const subscriber = TrackedEventSync.createTrackedEventSyncHandler(deps);

      await subscriber(createNonSpanEvent(), createContext(createFoldState()));

      expect(deps.recordTrackedEvent).not.toHaveBeenCalled();
    });
  });

  describe("when the span has no feedback events", () => {
    it("records no tracked event", async () => {
      const subscriber = TrackedEventSync.createTrackedEventSyncHandler(deps);
      const span = makeOtlpSpan([]);

      await subscriber(createSpanReceivedEvent(span), createContext(createFoldState()));

      expect(deps.recordTrackedEvent).not.toHaveBeenCalled();
    });
  });

  describe("when the span carries a langwatch.event with no event type", () => {
    /** @scenario "A malformed feedback event is ignored" */
    it("attaches no tracked event to the trace", async () => {
      const subscriber = TrackedEventSync.createTrackedEventSyncHandler(deps);
      const span = makeOtlpSpan([{ metrics: { vote: 1 } }]);

      await subscriber(createSpanReceivedEvent(span), createContext(createFoldState()));

      expect(deps.recordTrackedEvent).not.toHaveBeenCalled();
    });
  });

  describe("when the span carries a thumbs-up feedback event", () => {
    /** @scenario "A thumbs-up vote on a span becomes a tracked event" */
    it("records a tracked event with the type, metrics, and details", async () => {
      const subscriber = TrackedEventSync.createTrackedEventSyncHandler(deps);
      const span = makeOtlpSpan([
        {
          type: "thumbs_up_down",
          metrics: { vote: 1 },
          details: { feedback: "great answer" },
        },
      ]);

      await subscriber(createSpanReceivedEvent(span), createContext(createFoldState()));

      expect(deps.recordTrackedEvent).toHaveBeenCalledTimes(1);
      const call = vi.mocked(deps.recordTrackedEvent).mock.calls[0]![0];
      expect(call.tenantId).toBe("context-tenant-1");
      expect(call.body.trace_id).toBe("trace-1");
      expect(call.body.event_type).toBe("thumbs_up_down");
      expect(call.body.metrics).toEqual({ vote: 1 });
      expect(call.body.event_details).toEqual({ feedback: "great answer" });
    });

    it("derives a deterministic event id from trace, span, and event type", async () => {
      const subscriber = TrackedEventSync.createTrackedEventSyncHandler(deps);
      const span = makeOtlpSpan([{ type: "thumbs_up_down", metrics: { vote: 1 } }]);
      const event = createSpanReceivedEvent(span);

      await subscriber(event, createContext(createFoldState()));
      await subscriber(event, createContext(createFoldState()));

      const id1 = vi.mocked(deps.recordTrackedEvent).mock.calls[0]![0].eventId;
      const id2 = vi.mocked(deps.recordTrackedEvent).mock.calls[1]![0].eventId;
      expect(id1).toBe(id2);
    });
  });

  describe("when a predefined event type fails its schema", () => {
    it("does not record the invalid event", async () => {
      const subscriber = TrackedEventSync.createTrackedEventSyncHandler(deps);
      // thumbs_up_down requires a vote in [-1, 1]; 5 is out of range.
      const span = makeOtlpSpan([{ type: "thumbs_up_down", metrics: { vote: 5 } }]);

      await subscriber(createSpanReceivedEvent(span), createContext(createFoldState()));

      expect(deps.recordTrackedEvent).not.toHaveBeenCalled();
    });
  });

  describe("when the span carries multiple feedback events", () => {
    it("records a tracked event for each", async () => {
      const subscriber = TrackedEventSync.createTrackedEventSyncHandler(deps);
      const span = makeOtlpSpan([
        { type: "thumbs_up_down", metrics: { vote: 1 } },
        { type: "waited_to_finish", metrics: { finished: 1 } },
      ]);

      await subscriber(createSpanReceivedEvent(span), createContext(createFoldState()));

      expect(deps.recordTrackedEvent).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the span carries two feedback events of the same type", () => {
    it("records both under distinct event ids", async () => {
      const subscriber = TrackedEventSync.createTrackedEventSyncHandler(deps);
      const span = makeOtlpSpan([
        { type: "thumbs_up_down", metrics: { vote: 1 } },
        { type: "thumbs_up_down", metrics: { vote: -1 } },
      ]);

      await subscriber(createSpanReceivedEvent(span), createContext(createFoldState()));

      expect(deps.recordTrackedEvent).toHaveBeenCalledTimes(2);
      const calls = vi.mocked(deps.recordTrackedEvent).mock.calls;
      expect(calls[0]![0].eventId).not.toBe(calls[1]![0].eventId);
      expect(calls[0]![0].body.metrics).toEqual({ vote: 1 });
      expect(calls[1]![0].body.metrics).toEqual({ vote: -1 });
    });

    it("keeps each event id stable across a replay", async () => {
      const subscriber = TrackedEventSync.createTrackedEventSyncHandler(deps);
      const span = makeOtlpSpan([
        { type: "thumbs_up_down", metrics: { vote: 1 } },
        { type: "thumbs_up_down", metrics: { vote: -1 } },
      ]);
      const event = createSpanReceivedEvent(span);

      await subscriber(event, createContext(createFoldState()));
      await subscriber(event, createContext(createFoldState()));

      const calls = vi.mocked(deps.recordTrackedEvent).mock.calls;
      expect(calls[0]![0].eventId).toBe(calls[2]![0].eventId);
      expect(calls[1]![0].eventId).toBe(calls[3]![0].eventId);
    });
  });

  describe("when recording the first of two feedback events fails", () => {
    it("still records the second event", async () => {
      vi.mocked(deps.recordTrackedEvent)
        .mockRejectedValueOnce(new Error("clickhouse unavailable"))
        .mockResolvedValueOnce(undefined);
      const subscriber = TrackedEventSync.createTrackedEventSyncHandler(deps);
      const span = makeOtlpSpan([
        { type: "thumbs_up_down", metrics: { vote: 1 } },
        { type: "waited_to_finish", metrics: { finished: 1 } },
      ]);

      await expect(
        subscriber(createSpanReceivedEvent(span), createContext(createFoldState())),
      ).rejects.toThrow("clickhouse unavailable");

      expect(deps.recordTrackedEvent).toHaveBeenCalledTimes(2);
      const secondCall = vi.mocked(deps.recordTrackedEvent).mock.calls[1]![0];
      expect(secondCall.body.event_type).toBe("waited_to_finish");
    });

    it("rethrows so the framework retries the whole span", async () => {
      vi.mocked(deps.recordTrackedEvent).mockRejectedValue(new Error("clickhouse unavailable"));
      const subscriber = TrackedEventSync.createTrackedEventSyncHandler(deps);
      const span = makeOtlpSpan([{ type: "thumbs_up_down", metrics: { vote: 1 } }]);

      await expect(
        subscriber(createSpanReceivedEvent(span), createContext(createFoldState())),
      ).rejects.toThrow("clickhouse unavailable");
    });
  });

  describe("when the event is too old", () => {
    it("records no tracked event", async () => {
      const subscriber = TrackedEventSync.createTrackedEventSyncHandler(deps);
      const span = makeOtlpSpan([{ type: "thumbs_up_down", metrics: { vote: 1 } }]);
      const oldEvent = createSpanReceivedEvent(span, {
        occurredAt: Date.now() - 2 * 60 * 60 * 1000,
      } as Partial<SpanReceivedEvent>);

      await subscriber(oldEvent, createContext(createFoldState()));

      expect(deps.recordTrackedEvent).not.toHaveBeenCalled();
    });
  });

  describe("given a span this ingestion path emitted itself", () => {
    describe("when the recorded event type is the envelope name", () => {
      it("records no tracked event", async () => {
        const subscriber = TrackedEventSync.createTrackedEventSyncHandler(deps);
        const span = makeRecordedTrackEventSpan("langwatch.event");

        await subscriber(createSpanReceivedEvent(span), createContext(createFoldState()));

        expect(deps.recordTrackedEvent).not.toHaveBeenCalled();
      });

      it("declines to react", () => {
        const span = makeRecordedTrackEventSpan("langwatch.event");

        expect(TrackedEventSync.hasSyncableFeedback(createSpanReceivedEvent(span))).toBe(false);
      });
    });

    describe("when the recorded event type is an ordinary feedback type", () => {
      it("records no tracked event", async () => {
        const subscriber = TrackedEventSync.createTrackedEventSyncHandler(deps);
        const span = makeRecordedTrackEventSpan("thumbs_up_down");

        await subscriber(createSpanReceivedEvent(span), createContext(createFoldState()));

        expect(deps.recordTrackedEvent).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a span claiming the envelope name as its event type", () => {
    it("records no tracked event", async () => {
      const subscriber = TrackedEventSync.createTrackedEventSyncHandler(deps);
      const span = makeOtlpSpan([{ type: "langwatch.event", metrics: { vote: 1 } }]);

      await subscriber(createSpanReceivedEvent(span), createContext(createFoldState()));

      expect(deps.recordTrackedEvent).not.toHaveBeenCalled();
    });
  });

  describe("given an ordinary SDK feedback span", () => {
    it("still records exactly one tracked event", async () => {
      const subscriber = TrackedEventSync.createTrackedEventSyncHandler(deps);
      const span = makeOtlpSpan([{ type: "thumbs_up_down", metrics: { vote: 1 } }]);
      const event = createSpanReceivedEvent(span);

      expect(TrackedEventSync.hasSyncableFeedback(event)).toBe(true);

      await subscriber(event, createContext(createFoldState()));

      expect(deps.recordTrackedEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe("when deciding whether the span carries syncable feedback", () => {
    describe("when the span carries feedback events", () => {
      it("returns true", () => {
        const span = makeOtlpSpan([{ type: "thumbs_up_down", metrics: { vote: 1 } }]);

        expect(TrackedEventSync.hasSyncableFeedback(createSpanReceivedEvent(span))).toBe(true);
      });
    });

    describe("when the span has no feedback events", () => {
      it("returns false", () => {
        const span = makeOtlpSpan([]);

        expect(TrackedEventSync.hasSyncableFeedback(createSpanReceivedEvent(span))).toBe(false);
      });
    });

    describe("when the event is not a SpanReceivedEvent", () => {
      it("returns false", () => {
        expect(TrackedEventSync.hasSyncableFeedback(createNonSpanEvent())).toBe(false);
      });
    });
  });
});
