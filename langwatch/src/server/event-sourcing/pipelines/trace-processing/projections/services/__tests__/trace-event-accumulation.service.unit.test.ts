import { describe, expect, it } from "vitest";

import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { NormalizedSpanKind } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";

import {
  accumulateEvents,
  TRACE_EVENTS_MAX_BYTES,
} from "../trace-event-accumulation.service";

function makeSpanWithEvents(
  spanId: string,
  events: NormalizedSpan["events"],
): NormalizedSpan {
  return {
    id: spanId,
    traceId: "trace-1",
    spanId,
    tenantId: "tenant-1",
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: 1000,
    endTimeUnixMs: 2000,
    durationMs: 1000,
    name: "span",
    kind: NormalizedSpanKind.INTERNAL,
    resourceAttributes: {},
    spanAttributes: {},
    events,
    links: [],
    statusMessage: null,
    statusCode: null,
    instrumentationScope: { name: "test", version: null },
    droppedAttributesCount: 0 as 0,
    droppedEventsCount: 0 as 0,
    droppedLinksCount: 0 as 0,
  };
}

function stateWith(events: TraceSummaryData["events"]): TraceSummaryData {
  return { events } as TraceSummaryData;
}

function bigEvent(name: string, payloadBytes: number) {
  return {
    name,
    timeUnixMs: 1500,
    attributes: { payload: "x".repeat(payloadBytes) },
  };
}

describe("accumulateEvents", () => {
  describe("given a span with no events", () => {
    it("returns the existing events untouched and reports no drop", () => {
      const state = stateWith([
        { spanId: "s0", timestamp: 1, name: "e0", attributes: {} },
      ]);
      const result = accumulateEvents({
        state,
        span: makeSpanWithEvents("s1", []),
      });
      expect(result.events).toBe(state.events);
      expect(result.dropped).toBe(false);
    });
  });

  describe("given tracked events that stay within the size budget", () => {
    /** @scenario 'A small event stream is kept in full' */
    it("keeps every event and reports no drop", () => {
      const span = makeSpanWithEvents("s1", [
        bigEvent("a", 1024),
        bigEvent("b", 1024),
      ]);
      const result = accumulateEvents({ state: stateWith([]), span });
      expect(result.events).toHaveLength(2);
      expect(result.dropped).toBe(false);
    });
  });

  describe("given tracked events that far exceed the size budget", () => {
    /** @scenario 'The accumulated events list is capped by a total size budget' */
    it("caps the list at the budget, preserves the earliest events, and reports the drop", () => {
      // Each event is ~64 KiB; folding many of them across one span would
      // blow past the 256 KiB budget without the cap.
      const events = Array.from({ length: 40 }, (_, i) =>
        bigEvent(`e${i}`, 64 * 1024),
      );
      const span = makeSpanWithEvents("s1", events);

      const result = accumulateEvents({ state: stateWith([]), span });
      const kept = result.events ?? [];

      expect(result.dropped).toBe(true);
      const bytes = Buffer.byteLength(JSON.stringify(kept), "utf8");
      expect(bytes).toBeLessThanOrEqual(TRACE_EVENTS_MAX_BYTES);
      // earliest events survive, later ones are dropped
      expect(kept[0]?.name).toBe("e0");
      expect(kept.length).toBeLessThan(events.length);
    });
  });

  describe("given hundreds of spans each carrying events, folded one at a time", () => {
    /** @scenario 'A bounded state stays cacheable across fold steps' */
    it("keeps the accumulated events within the budget across every fold step", () => {
      let state = stateWith([]);
      for (let i = 0; i < 300; i++) {
        const span = makeSpanWithEvents(`s${i}`, [bigEvent(`e${i}`, 16 * 1024)]);
        const result = accumulateEvents({ state, span });
        state = stateWith(result.events);
        // Invariant on EVERY step: the state never grows past the budget, so
        // it always fits the write-through cache (no quadratic re-read).
        const bytes = Buffer.byteLength(JSON.stringify(state.events), "utf8");
        expect(bytes).toBeLessThanOrEqual(TRACE_EVENTS_MAX_BYTES);
      }
    });
  });

  describe("given an already-full events list", () => {
    it("does not append further events once the budget is reached", () => {
      const existing = Array.from({ length: 4 }, (_, i) => ({
        spanId: `s${i}`,
        timestamp: i,
        name: `pre${i}`,
        attributes: { payload: "y".repeat(64 * 1024) },
      }));
      const span = makeSpanWithEvents("s9", [bigEvent("new", 64 * 1024)]);

      const result = accumulateEvents({ state: stateWith(existing), span });
      expect(result.dropped).toBe(true);
      expect((result.events ?? []).some((e) => e.name === "new")).toBe(false);
    });
  });
});
