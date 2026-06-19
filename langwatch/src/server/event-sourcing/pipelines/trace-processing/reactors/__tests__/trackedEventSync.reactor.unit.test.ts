import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { ReactorContext } from "../../../../reactors/reactor.types";
import type {
  SpanReceivedEvent,
  TraceProcessingEvent,
} from "../../schemas/events";
import type { OtlpSpan } from "../../schemas/otlp";
import {
  createTrackedEventSyncReactor,
  extractTrackedEventsFromSpan,
  type TrackedEventSyncReactorDeps,
} from "../trackedEventSync.reactor";

type FeedbackEvent = {
  type?: string;
  metrics?: Record<string, number>;
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

function createContext(
  foldState: TraceSummaryData,
): ReactorContext<TraceSummaryData> {
  return {
    tenantId: "tenant-1",
    aggregateId: "trace-1",
    foldState,
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

      const result = extractTrackedEventsFromSpan(span);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        event_type: "thumbs_up_down",
        metrics: { vote: 1 },
        event_details: { feedback: "great answer" },
      });
    });
  });

  describe("given a span with no feedback events", () => {
    it("returns an empty array", () => {
      const span = makeOtlpSpan([]);

      expect(extractTrackedEventsFromSpan(span)).toHaveLength(0);
    });
  });

  describe("given a feedback event with no event type", () => {
    it("skips the malformed event", () => {
      const span = makeOtlpSpan([{ metrics: { vote: 1 } }]);

      expect(extractTrackedEventsFromSpan(span)).toHaveLength(0);
    });
  });

  describe("given a feedback event with only an event type", () => {
    it("reconstructs it with empty metrics and details", () => {
      const span = makeOtlpSpan([{ type: "waited_to_finish" }]);

      const result = extractTrackedEventsFromSpan(span);

      expect(result[0]).toEqual({
        event_type: "waited_to_finish",
        metrics: {},
        event_details: {},
      });
    });
  });
});

describe("trackedEventSync reactor", () => {
  let deps: TrackedEventSyncReactorDeps;

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
      const reactor = createTrackedEventSyncReactor(deps);

      await reactor.handle(createNonSpanEvent(), createContext(createFoldState()));

      expect(deps.recordTrackedEvent).not.toHaveBeenCalled();
    });
  });

  describe("when the span has no feedback events", () => {
    it("records no tracked event", async () => {
      const reactor = createTrackedEventSyncReactor(deps);
      const span = makeOtlpSpan([]);

      await reactor.handle(
        createSpanReceivedEvent(span),
        createContext(createFoldState()),
      );

      expect(deps.recordTrackedEvent).not.toHaveBeenCalled();
    });
  });

  describe("when the span carries a thumbs-up feedback event", () => {
    it("records a tracked event with the type, metrics, and details", async () => {
      const reactor = createTrackedEventSyncReactor(deps);
      const span = makeOtlpSpan([
        {
          type: "thumbs_up_down",
          metrics: { vote: 1 },
          details: { feedback: "great answer" },
        },
      ]);

      await reactor.handle(
        createSpanReceivedEvent(span),
        createContext(createFoldState()),
      );

      expect(deps.recordTrackedEvent).toHaveBeenCalledTimes(1);
      const call = vi.mocked(deps.recordTrackedEvent).mock.calls[0]![0];
      expect(call.tenantId).toBe("tenant-1");
      expect(call.body.trace_id).toBe("trace-1");
      expect(call.body.event_type).toBe("thumbs_up_down");
      expect(call.body.metrics).toEqual({ vote: 1 });
      expect(call.body.event_details).toEqual({ feedback: "great answer" });
    });

    it("derives a deterministic event id from trace, span, and event type", async () => {
      const reactor = createTrackedEventSyncReactor(deps);
      const span = makeOtlpSpan([{ type: "thumbs_up_down", metrics: { vote: 1 } }]);
      const event = createSpanReceivedEvent(span);

      await reactor.handle(event, createContext(createFoldState()));
      await reactor.handle(event, createContext(createFoldState()));

      const id1 = vi.mocked(deps.recordTrackedEvent).mock.calls[0]![0].eventId;
      const id2 = vi.mocked(deps.recordTrackedEvent).mock.calls[1]![0].eventId;
      expect(id1).toBe(id2);
    });
  });

  describe("when a predefined event type fails its schema", () => {
    it("does not record the invalid event", async () => {
      const reactor = createTrackedEventSyncReactor(deps);
      // thumbs_up_down requires a vote in [-1, 1]; 5 is out of range.
      const span = makeOtlpSpan([
        { type: "thumbs_up_down", metrics: { vote: 5 } },
      ]);

      await reactor.handle(
        createSpanReceivedEvent(span),
        createContext(createFoldState()),
      );

      expect(deps.recordTrackedEvent).not.toHaveBeenCalled();
    });
  });

  describe("when the span carries multiple feedback events", () => {
    it("records a tracked event for each", async () => {
      const reactor = createTrackedEventSyncReactor(deps);
      const span = makeOtlpSpan([
        { type: "thumbs_up_down", metrics: { vote: 1 } },
        { type: "waited_to_finish", metrics: { finished: 1 } },
      ]);

      await reactor.handle(
        createSpanReceivedEvent(span),
        createContext(createFoldState()),
      );

      expect(deps.recordTrackedEvent).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the event is too old", () => {
    it("records no tracked event", async () => {
      const reactor = createTrackedEventSyncReactor(deps);
      const span = makeOtlpSpan([{ type: "thumbs_up_down", metrics: { vote: 1 } }]);
      const oldEvent = createSpanReceivedEvent(span, {
        occurredAt: Date.now() - 2 * 60 * 60 * 1000,
      } as Partial<SpanReceivedEvent>);

      await reactor.handle(oldEvent, createContext(createFoldState()));

      expect(deps.recordTrackedEvent).not.toHaveBeenCalled();
    });
  });

  describe("when deciding whether to react", () => {
    describe("when the span carries feedback events", () => {
      it("returns true", () => {
        const reactor = createTrackedEventSyncReactor(deps);
        const span = makeOtlpSpan([{ type: "thumbs_up_down", metrics: { vote: 1 } }]);

        expect(
          reactor.shouldReact!(
            createSpanReceivedEvent(span),
            createContext(createFoldState()),
          ),
        ).toBe(true);
      });
    });

    describe("when the span has no feedback events", () => {
      it("returns false", () => {
        const reactor = createTrackedEventSyncReactor(deps);
        const span = makeOtlpSpan([]);

        expect(
          reactor.shouldReact!(
            createSpanReceivedEvent(span),
            createContext(createFoldState()),
          ),
        ).toBe(false);
      });
    });

    describe("when the event is not a SpanReceivedEvent", () => {
      it("returns false", () => {
        const reactor = createTrackedEventSyncReactor(deps);

        expect(
          reactor.shouldReact!(
            createNonSpanEvent(),
            createContext(createFoldState()),
          ),
        ).toBe(false);
      });
    });
  });
});
