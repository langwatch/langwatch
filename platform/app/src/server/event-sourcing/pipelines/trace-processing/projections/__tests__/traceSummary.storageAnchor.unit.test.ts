import { describe, expect, it } from "vitest";
import { LOG_RECORD_RECEIVED_EVENT_TYPE } from "../../schemas/constants";
import {
  type TraceSummaryData,
  TraceSummaryFoldProjection,
} from "../traceSummary.foldProjection";
import {
  createSpanReceivedEvent,
  msToUnixNano,
} from "./fixtures/trace-summary-test.fixtures";

const TRACE_ID = "aaaa0000000000000000000000000012";
const BASE_MS = 1_760_000_000_000;

const projection = new TraceSummaryFoldProjection({
  store: { store: async () => {}, get: async () => null },
});

function fold(
  state: TraceSummaryData,
  event: { type: string },
): TraceSummaryData {
  return projection.apply(state, event);
}

function logEvent(occurredAt: number) {
  return {
    id: "log-1",
    type: LOG_RECORD_RECEIVED_EVENT_TYPE,
    tenantId: "tenant-1",
    aggregateId: TRACE_ID,
    occurredAt,
    data: {
      traceId: TRACE_ID,
      spanId: "bbbb000000000001",
      timeUnixMs: occurredAt,
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
  } as unknown as { type: string };
}

function spanEvent(id: string, startMs: number, endMs: number) {
  return createSpanReceivedEvent({
    eventId: id,
    traceId: TRACE_ID,
    spanId: id.padEnd(16, "0").slice(0, 16),
    parentSpanId: null,
    occurredAt: endMs,
    startTimeUnixNano: msToUnixNano(startMs),
    endTimeUnixNano: msToUnixNano(endMs),
  }) as unknown as { type: string };
}

describe("traceSummary storage anchor", () => {
  it("anchors a log-only trace in real time without inventing a span baseline", () => {
    const state = fold(projection.init(), logEvent(BASE_MS));

    expect(state.storageAnchorMs).toBe(BASE_MS);
    expect(state.occurredAt).toBe(0);
    expect(state.totalDurationMs).toBe(0);
  });

  it("anchors a span-led trace on the span start rather than ingest time", () => {
    const startMs = BASE_MS + 500;
    const state = fold(
      projection.init(),
      spanEvent("span-1", startMs, BASE_MS + 3_000),
    );

    expect(state.storageAnchorMs).toBe(startMs);
    expect(state.occurredAt).toBe(startMs);
    expect(state.storageAnchorMs).toBeLessThan(state.LastEventOccurredAt);
  });

  it("moves the duration baseline, but not storage, for a late earlier span", () => {
    const firstStartMs = BASE_MS + 5_000;
    const earlierStartMs = BASE_MS + 1_000;
    const anchored = fold(
      projection.init(),
      spanEvent("span-1", firstStartMs, BASE_MS + 6_000),
    );
    const updated = fold(
      anchored,
      spanEvent("span-2", earlierStartMs, BASE_MS + 2_000),
    );

    expect(updated.storageAnchorMs).toBe(firstStartMs);
    expect(updated.occurredAt).toBe(earlierStartMs);
  });

  it("keeps a log-first anchor when a span arrives later", () => {
    const logAtMs = BASE_MS + 60_000;
    const logged = fold(projection.init(), logEvent(logAtMs));
    const spanned = fold(
      logged,
      spanEvent("span-1", logAtMs - 5_000, logAtMs - 1_000),
    );

    expect(spanned.storageAnchorMs).toBe(logAtMs);
    expect(spanned.occurredAt).toBe(logAtMs - 5_000);
  });
});
