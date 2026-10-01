import { createTenantId } from "@langwatch/eventing";
import {
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
  type LogRecordReceivedEvent,
  type TraceSummaryData,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import { TraceSummaryFoldProjection } from "../trace-summary.projection.ts";
import {
  createSpanReceivedEvent,
  createTestRuntime,
  msToUnixNano,
} from "./trace-summary-test.fixtures.ts";

/** The trace-summary fold's STORAGE ANCHOR (ADR-087, migration 00072). OccurredAt
 * is the partition key and TTL anchor, now separate from span timing baseline
 * (storageAnchorMs). Tests drive the fold through projection.apply. */

const TRACE_ID = "aaaa0000000000000000000000000012";
const BASE_MS = 1_760_000_000_000;

const projection = TraceSummaryFoldProjection.create({
  store: { store: async () => {}, get: async () => ({ kind: "empty" as const }) },
  traceCanonicalisation: TraceCanonicalisationService.create(),
  runtime: createTestRuntime(),
});

type FoldEvent = { type: string };

function fold(state: TraceSummaryData, event: FoldEvent): TraceSummaryData {
  return projection.apply(state, event as never);
}

/** A `log_record_received` event whose envelope was accepted at `acceptedAtMs`. */
function logEvent(acceptedAtMs: number): LogRecordReceivedEvent {
  return {
    id: "log-1",
    type: LOG_RECORD_RECEIVED_EVENT_TYPE,
    version: LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
    tenantId: createTenantId("tenant-1"),
    aggregateId: TRACE_ID,
    aggregateType: "trace",
    createdAt: acceptedAtMs,
    occurredAt: acceptedAtMs,
    data: {
      traceId: TRACE_ID,
      spanId: "bbbb000000000001",
      timeUnixMs: acceptedAtMs,
      severityNumber: 9,
      severityText: "INFO",
      body: "request",
      attributes: {},
      resourceAttributes: {},
      scopeName: "test",
      scopeVersion: null,
      piiRedactionLevel: "DISABLED",
    },
    metadata: {},
  };
}

function spanEvent(id: string, startMs: number, endMs: number): FoldEvent {
  return createSpanReceivedEvent({
    eventId: id,
    traceId: TRACE_ID,
    spanId: id.padEnd(16, "0").slice(0, 16),
    parentSpanId: null,
    // The envelope is stamped at INGEST, which is why a span-led trace must
    // anchor on the span's own start rather than on this.
    occurredAt: endMs + 30_000,
    startTimeUnixNano: msToUnixNano(startMs),
    endTimeUnixNano: msToUnixNano(endMs),
  });
}

describe("given a trace-summary fold that anchors its storage time", () => {
  describe("when the trace's only signal is a log record", () => {
    /** @scenario "A trace whose only signal is a log record is filed under a real time" */
    it("anchors on the accepted time and leaves the span baseline unseeded", () => {
      const state = fold(projection.init(), logEvent(BASE_MS));

      expect(state.storageAnchorMs).toBe(BASE_MS);
      // Not seeded from the log: SpanTimingService measures totalDurationMs from
      // this field, so a log accepted after the trace finished would inflate the
      // duration by the whole ingest lag.
      expect(state.occurredAt).toBe(0);
      expect(state.totalDurationMs).toBe(0);
    });
  });

  describe("when the trace's first contribution is a span", () => {
    /** @scenario "A trace whose first contribution is a span is filed under that span's start" */
    it("anchors on the span's own start rather than on the ingest stamp", () => {
      const startMs = BASE_MS + 500;
      const event = spanEvent("span-1", startMs, BASE_MS + 3_000);

      const state = fold(projection.init(), event);

      expect(state.storageAnchorMs).toBe(startMs);
      expect(state.occurredAt).toBe(startMs);
      expect(state.storageAnchorMs).toBeLessThan(state.LastEventOccurredAt);
    });
  });

  describe("when an earlier-starting span arrives after the anchor is frozen", () => {
    /** @scenario "A late earlier-starting span moves the trace's reported start, not where it is filed" */
    it("moves the timing baseline and leaves the anchor where it was", () => {
      const firstStartMs = BASE_MS + 5_000;
      const earlierStartMs = BASE_MS + 1_000;
      const anchored = fold(projection.init(), spanEvent("span-1", firstStartMs, BASE_MS + 6_000));

      const updated = fold(anchored, spanEvent("span-2", earlierStartMs, BASE_MS + 2_000));

      expect(updated.storageAnchorMs).toBe(firstStartMs);
      expect(updated.occurredAt).toBe(earlierStartMs);
    });
  });

  describe("when a producer reports a start time years in the future", () => {
    /** @scenario "A trace claiming to start years ahead is not filed years ahead" */
    it("refuses it as an anchor so the row cannot outlive its retention", () => {
      // Ingest bounds only the past edge, so a 13-digit epoch-ms value years
      // ahead reaches the fold. Freezing it would fix the row's partition AND
      // its `OccurredAt + retention` TTL deadline in that year.
      const farFutureMs = Date.now() + 365 * 24 * 60 * 60 * 1000;

      const state = fold(projection.init(), spanEvent("span-1", farFutureMs, farFutureMs + 1_000));

      expect(state.storageAnchorMs).toBe(0);
    });
  });

  describe("when a log record leads and a span follows", () => {
    it("keeps the log-led anchor and takes the baseline from the span", () => {
      const acceptedAtMs = BASE_MS + 60_000;
      const logged = fold(projection.init(), logEvent(acceptedAtMs));

      const spanned = fold(logged, spanEvent("span-1", acceptedAtMs - 5_000, acceptedAtMs - 1_000));

      expect(spanned.storageAnchorMs).toBe(acceptedAtMs);
      expect(spanned.occurredAt).toBe(acceptedAtMs - 5_000);
    });
  });

  describe("when an event type the fold does not handle arrives first", () => {
    it("anchors nothing, because no contribution was folded", () => {
      const unhandled = { type: "lw.obs.trace.not.a.real.event", occurredAt: BASE_MS };
      const state = fold(projection.init(), unhandled);

      expect(state.storageAnchorMs).toBe(0);
    });
  });
});

/** Migration 00072 and ADR-087 state what the anchor does NOT recover. The
 * migration promises an operator must hold for the three fold options to
 * guarantee the recovery account; they are pinned here. */
describe("given the migration's account of what the anchor does not recover", () => {
  it("holds the three fold options that account depends on", () => {
    const options = projection.options as {
      trustAbsentMiss?: boolean;
      refoldOnStoreMiss?: boolean;
      readWindow?: { widthMs: number };
    };

    // An absent windowed read is final — no unwindowed retry that could find
    // the epoch row.
    expect(options.trustAbsentMiss).toBe(true);
    // And no event_log rebuild behind that miss. Turning this on is the
    // deferred data-loss decision (#6312), not a silent change.
    expect(options.refoldOnStoreMiss).toBeUndefined();
    // A window far narrower than the ~56 years between the epoch partition and
    // a present-day event, which is why the miss happens at all.
    expect(options.readWindow?.widthMs).toBeLessThan(Date.now() - new Date(0).getTime());
  });
});
