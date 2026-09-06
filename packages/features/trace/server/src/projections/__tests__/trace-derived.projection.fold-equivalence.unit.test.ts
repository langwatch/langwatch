import {
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  TOPIC_ASSIGNED_EVENT_TYPE,
  TRACE_NAME_CHANGED_EVENT_TYPE,
} from "@langwatch/trace-contract";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import {
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  TraceAnalyticsFoldProjection,
  type TraceAnalyticsData,
  type TraceAnalyticsRow,
} from "../trace-derived.projection.ts";
import {
  createSpanReceivedEvent,
  createTestRuntime,
  msToUnixNano,
} from "./fixtures/trace-summary-test.fixtures.ts";

/**
 * The read-back boundary is a DESERIALIZE, not a rebuild: a fold resumed from
 * its last committed slim row must reach exactly the row the fold that never
 * lost its state reaches. Any working field the trim drops and the decoder does
 * not recover shows up here as a column that diverges after the split.
 */

const TENANT = "tenant-fold-eq";
const TRACE_ID = "aaaa0000000000000000000000000003";
const BASE_MS = 1_760_000_000_000;

const runtime = createTestRuntime();
const projection = TraceAnalyticsFoldProjection.create({
  store: { store: async () => {}, tryGet: async () => null },
  traceCanonicalisation: TraceCanonicalisationService.create(),
  runtime,
});

function project(state: TraceAnalyticsData): TraceAnalyticsRow {
  return TraceAnalyticsFoldProjection.projectAnalyticsStateToRow({
    state,
    tenantId: TENANT,
    version: TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  });
}

/** The persistence boundary, round-tripped: state -> row -> state. */
function roundTrip(state: TraceAnalyticsData): TraceAnalyticsData {
  return TraceAnalyticsFoldProjection.traceAnalyticsStateFromRow(project(state));
}

type FoldEvent = { type: string };

function foldAll(events: readonly FoldEvent[], from: TraceAnalyticsData): TraceAnalyticsData {
  return events.reduce((state, event) => projection.apply(state, event as never), from);
}

function spanEvent({
  eventId,
  spanId,
  parentSpanId = null,
  name,
  startMs,
  endMs,
  attributes,
}: {
  eventId: string;
  spanId: string;
  parentSpanId?: string | null;
  name: string;
  startMs: number;
  endMs: number;
  attributes?: Record<string, string | number | boolean>;
}): FoldEvent {
  return createSpanReceivedEvent({
    eventId,
    tenantId: TENANT,
    traceId: TRACE_ID,
    spanId,
    parentSpanId,
    name,
    occurredAt: endMs,
    startTimeUnixNano: msToUnixNano(startMs),
    endTimeUnixNano: msToUnixNano(endMs),
    attributes,
  }) as FoldEvent;
}

function logRecordEvent({
  eventId,
  occurredAt,
}: {
  eventId: string;
  occurredAt: number;
}): FoldEvent {
  return {
    id: eventId,
    type: LOG_RECORD_RECEIVED_EVENT_TYPE,
    tenantId: TENANT,
    aggregateId: TRACE_ID,
    occurredAt,
    data: {
      traceId: TRACE_ID,
      spanId: `ffff00000000000${eventId.slice(-1)}`,
      timeUnixMs: occurredAt,
      severityNumber: 9,
      severityText: "INFO",
      body: "api_request",
      attributes: {},
      resourceAttributes: {},
      scopeName: "com.anthropic.claude_code",
      scopeVersion: null,
      piiRedactionLevel: "DISABLED",
    },
    metadata: {},
  } as unknown as FoldEvent;
}

function topicAssignedEvent(eventId: string, occurredAt: number): FoldEvent {
  return {
    id: eventId,
    type: TOPIC_ASSIGNED_EVENT_TYPE,
    tenantId: TENANT,
    aggregateId: TRACE_ID,
    occurredAt,
    data: {
      topicId: "topic-eq",
      topicName: "Support",
      subtopicId: null,
      subtopicName: null,
      isIncremental: false,
    },
    metadata: {},
  } as unknown as FoldEvent;
}

function renameEvent(eventId: string, occurredAt: number): FoldEvent {
  return {
    id: eventId,
    type: TRACE_NAME_CHANGED_EVENT_TYPE,
    tenantId: TENANT,
    aggregateId: TRACE_ID,
    occurredAt,
    data: { traceId: TRACE_ID, newName: "Renamed by a human" },
    metadata: {},
  } as unknown as FoldEvent;
}

/** A renamed trace whose later spans keep arriving, some starting earlier. */
const RENAMED_LIFECYCLE: readonly FoldEvent[] = [
  spanEvent({
    eventId: "evt-eq-1",
    spanId: "cccc000000000001",
    name: "agent-run",
    startMs: BASE_MS + 500,
    endMs: BASE_MS + 1500,
    attributes: { "langwatch.span.type": "agent", "gen_ai.usage.output_tokens": 30 },
  }),
  renameEvent("evt-eq-rename", BASE_MS + 1600),
  topicAssignedEvent("evt-eq-topic", BASE_MS + 1700),
  spanEvent({
    eventId: "evt-eq-2",
    spanId: "cccc000000000002",
    parentSpanId: "cccc000000000001",
    name: "llm-call",
    startMs: BASE_MS + 200,
    endMs: BASE_MS + 2500,
    attributes: { "langwatch.span.type": "llm", "gen_ai.usage.input_tokens": 90 },
  }),
];

/** Logs anchor the trace before any span arrives; the span lands late. */
const LOG_LED_LIFECYCLE: readonly FoldEvent[] = [
  logRecordEvent({ eventId: "evt-eq-log-1", occurredAt: BASE_MS + 1000 }),
  logRecordEvent({ eventId: "evt-eq-log-2", occurredAt: BASE_MS + 1500 }),
  topicAssignedEvent("evt-eq-log-topic", BASE_MS + 1800),
  spanEvent({
    eventId: "evt-eq-log-span",
    spanId: "ffff0000000000fe",
    name: "agent-run",
    startMs: BASE_MS + 200,
    endMs: BASE_MS + 2600,
    attributes: { "langwatch.span.type": "agent", "gen_ai.usage.output_tokens": 40 },
  }),
];

const SEQUENCES = [
  { name: "a trace a person renamed while spans kept arriving", events: RENAMED_LIFECYCLE },
  {
    name: "a trace whose first signals are log records, with a span arriving late",
    events: LOG_LED_LIFECYCLE,
  },
];

/** Every interior boundary — the property has to hold wherever the crash lands. */
function splitPointsOf(events: readonly FoldEvent[]): number[] {
  return events.map((_, index) => index + 1).slice(0, -1);
}

describe("traceAnalytics fold-equivalence across the read-back boundary", () => {
  // The base class stamps `updatedAt` as max(now, previous + 1). Frozen time
  // makes that purely a function of the previous value, so the two folds can be
  // compared on EVERY column instead of excusing a wall-clock one.
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_MS);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  describe.each(SEQUENCES)("given $name", ({ events }) => {
    describe.each(splitPointsOf(events))(
      "when the fold is interrupted after event %i and resumed from the committed row",
      (splitAt) => {
        const before = events.slice(0, splitAt);
        const after = events.slice(splitAt);

        /** @scenario a fold whose stored row is a slimmed analytics summary still recovers its working state */
        it("reaches the same row as the fold that never lost its state", () => {
          const committed = foldAll(before, projection.init());

          const uninterrupted = foldAll(after, committed);
          const resumed = foldAll(after, roundTrip(committed));

          expect(project(resumed)).toEqual(project(uninterrupted));
        });
      },
    );
  });
});
