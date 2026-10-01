/**
 * Only a span arrival opens the deferred-origin gate: a clustering pass
 * re-emits topic_assigned for its whole backlog stamped with the current
 * time, which the staleness check cannot catch (#8191).
 */

import type { TraceProcessingEvent, TraceSummaryData } from "@langwatch/trace-contract";
import { TOPIC_ASSIGNED_EVENT_TYPE } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { needsOriginResolution } from "../deferred-origin.process.ts";

function createEvent(overrides: Partial<TraceProcessingEvent> = {}): TraceProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.obs.trace.span_received",
    version: 1,
    data: {},
    metadata: { spanId: "span-1", traceId: "trace-1" },
    ...overrides,
  } as TraceProcessingEvent;
}

/** Only the field the gate reads; the rest of the fold is irrelevant here. */
function createFoldState(): TraceSummaryData {
  return { traceId: "trace-1", attributes: {} } as TraceSummaryData;
}

describe("needsOriginResolution()", () => {
  describe("when the event is a re-emitted topic assignment", () => {
    it("returns false even with no origin on the fold state", () => {
      expect(
        needsOriginResolution({
          event: createEvent({ type: TOPIC_ASSIGNED_EVENT_TYPE }),
          foldState: createFoldState(),
        }),
      ).toBe(false);
    });
  });

  describe("when the event is a span arrival with no origin", () => {
    it("returns true", () => {
      expect(
        needsOriginResolution({
          event: createEvent(),
          foldState: createFoldState(),
        }),
      ).toBe(true);
    });
  });
});
