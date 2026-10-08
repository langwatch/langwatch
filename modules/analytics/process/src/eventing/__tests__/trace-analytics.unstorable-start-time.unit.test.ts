/**
 * Regression: a span start time wrong by orders of magnitude used to block a whole project's
 * lane. Drives analytics' REAL fold and rollup map, moved here with the lanes from trace.
 * @see specs/traces/span-start-time-must-be-storable.feature
 */
import type { SpanReceivedEvent } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { TraceAnalyticsRollupMapProjection } from "../trace-analytics-rollup.projection.ts";
import { TraceAnalyticsFoldProjection } from "../trace-analytics.projection.ts";
import { createSpanReceivedEvent } from "./trace-analytics-test.fixtures.ts";

/** A present-day millisecond value pushed through a ms-to-ns conversion twice. */
const PRESENT_DAY_MS = 1_700_000_000_500n;
const TWICE_SCALED_NANO = String(PRESENT_DAY_MS * 1_000_000n * 1_000_000n);

function unstorableEvent(): SpanReceivedEvent {
  return createSpanReceivedEvent({
    tenantId: "project-regression",
    traceId: "aaaa0000000000000000000000000009",
    spanId: "bbbb000000000009",
    startTimeUnixNano: TWICE_SCALED_NANO,
    endTimeUnixNano: TWICE_SCALED_NANO,
  });
}

const noopFoldStore = { store: async () => {}, get: async () => ({ kind: "empty" as const }) };
const noopAppendStore = { append: async () => {}, bulkAppend: async () => {} } as never;

describe("given a span whose start time cannot be stored", () => {
  describe("when the analytics-rollup projection maps it", () => {
    /** @scenario "A stored span whose start time cannot be stored is skipped without blocking the rest of the project's spans" */
    it("skips the span instead of throwing", () => {
      const projection = TraceAnalyticsRollupMapProjection.create({ store: noopAppendStore });

      expect(projection.mapTraceSpanReceived(unstorableEvent())).toBeNull();
    });
  });

  describe("when the trace-analytics fold applies it", () => {
    /** @scenario "A stored span whose start time cannot be stored is skipped without blocking the rest of the project's spans" */
    it("leaves the trace's state untouched instead of throwing", () => {
      const projection = TraceAnalyticsFoldProjection.create({ store: noopFoldStore });
      const state = projection.init();

      const folded = projection.handleTraceSpanReceived(unstorableEvent(), state);

      expect(folded).toBe(state);
    });
  });
});
