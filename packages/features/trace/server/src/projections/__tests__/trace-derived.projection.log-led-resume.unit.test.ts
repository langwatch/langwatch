import { describe, expect, it } from "vitest";
import { LOG_RECORD_RECEIVED_EVENT_TYPE, TOPIC_ASSIGNED_EVENT_TYPE } from "@langwatch/trace-contract";
import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service";
import {
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  TraceAnalyticsFoldProjection,
  type TraceAnalyticsData,
  type TraceAnalyticsRow,
} from "../trace-derived.projection";
import { createSpanReceivedEvent, createTestRuntime, msToUnixNano } from "./fixtures/trace-summary-test.fixtures";

/**
 * The storage anchor and the span timing baseline, resumed across a
 * read-back (ADR-071 step 3 / migration 00061).
 *
 * A log-led trace freezes its anchor on the first log record, before any span
 * has arrived. If the fold is interrupted there and resumed from its
 * committed row, a late-arriving span that started BEFORE every log must pull
 * the timing baseline back — while the anchor, a storage address, stays
 * exactly where it was written. Decoding either field from the other's column
 * would only show up once a later event reads the one that moved.
 */

const TENANT = "tenant-log-led-resume";
const TRACE_ID = "aaaa0000000000000000000000000002";
const BASE_MS = 1_760_000_000_000;

const runtime = createTestRuntime();
const projection = TraceAnalyticsFoldProjection.create({
  store: { store: async () => {}, get: async () => null },
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

function logRecordEvent({ eventId, occurredAt }: { eventId: string; occurredAt: number }): FoldEvent {
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

function topicAssignedEvent(): FoldEvent {
  return {
    id: "evt-ll-topic",
    type: TOPIC_ASSIGNED_EVENT_TYPE,
    tenantId: TENANT,
    aggregateId: TRACE_ID,
    occurredAt: BASE_MS + 1800,
    data: {
      topicId: "topic-3",
      topicName: "Coding",
      subtopicId: null,
      subtopicName: null,
      isIncremental: false,
    },
    metadata: {},
  } as unknown as FoldEvent;
}

function spanEvent({
  eventId,
  spanId,
  startMs,
  endMs,
  attributes,
}: {
  eventId: string;
  spanId: string;
  startMs: number;
  endMs: number;
  attributes?: Record<string, string | number | boolean>;
}): FoldEvent {
  return createSpanReceivedEvent({
    eventId,
    tenantId: TENANT,
    traceId: TRACE_ID,
    spanId,
    parentSpanId: null,
    name: "agent-run",
    occurredAt: endMs,
    startTimeUnixNano: msToUnixNano(startMs),
    endTimeUnixNano: msToUnixNano(endMs),
    attributes,
  }) as FoldEvent;
}

/**
 * Two logs anchor the trace, a topic gets assigned, a third log lands, and
 * only then does a span finally arrive — starting BEFORE every log, so the
 * timing baseline ends up earlier than the anchor, which stays put.
 */
const LOG_LED_LIFECYCLE: readonly FoldEvent[] = [
  logRecordEvent({ eventId: "evt-ll-log-1", occurredAt: BASE_MS + 1000 }),
  logRecordEvent({ eventId: "evt-ll-log-2", occurredAt: BASE_MS + 1500 }),
  topicAssignedEvent(),
  logRecordEvent({ eventId: "evt-ll-log-3", occurredAt: BASE_MS + 2000 }),
  spanEvent({
    eventId: "evt-ll-span",
    spanId: "ffff0000000000ff",
    startMs: BASE_MS + 200,
    endMs: BASE_MS + 2500,
    attributes: {
      "langwatch.span.type": "agent",
      "gen_ai.usage.output_tokens": 40,
    },
  }),
];

describe("given the log-led trace interrupted before its span arrives", () => {
  const splitAt = LOG_LED_LIFECYCLE.length - 2;
  const committed = foldAll(LOG_LED_LIFECYCLE.slice(0, splitAt), projection.init());
  const rest = LOG_LED_LIFECYCLE.slice(splitAt);

  /** @scenario A log-led trace resumed from its committed row keeps its anchor and its timing */
  it("resumes with the anchor its first log froze", () => {
    const uninterrupted = foldAll(rest, committed);
    const resumed = foldAll(rest, roundTrip(committed));

    expect(resumed.storageAnchorMs).toBe(uninterrupted.storageAnchorMs);
    expect(project(resumed).occurredAtMs).toBe(project(committed).occurredAtMs);
  });

  /** @scenario A log-led trace resumed from its committed row keeps its anchor and its timing */
  it("resumes with the same timing baseline the late span sets", () => {
    const uninterrupted = foldAll(rest, committed);
    const resumed = foldAll(rest, roundTrip(committed));

    // The span in the tail starts BEFORE every log, so this is also the case
    // where the baseline ends up earlier than the anchor — decoding one from
    // the other's column would be visible here.
    expect(resumed.occurredAt).toBe(uninterrupted.occurredAt);
    expect(resumed.occurredAt).toBeLessThan(resumed.storageAnchorMs as number);
    expect(resumed.totalDurationMs).toBe(uninterrupted.totalDurationMs);
  });
});
