/**
 * The time a trace row and its drawer header show for a log-only trace: the
 * storage anchor, never the raw span baseline of 0, which rendered as
 * "20684d ago" in the list and the drawer while the single-trace read
 * reported the honest time.
 *
 * Feature: specs/traces/trace-summary-storage-anchor.feature
 */
import { describe, expect, it } from "vitest";

import { mapTraceSummaryToHeader } from "~/server/api/routers/tracesV2";
import { mapToTraceListItem } from "../trace-list.service";
import type { TraceSummaryData } from "../types";

const ANCHOR_MS = 1_787_122_009_599;

function summary(overrides: Partial<TraceSummaryData>): TraceSummaryData {
  return {
    traceId: "trace_1",
    spanCount: 0,
    totalDurationMs: 0,
    computedInput: null,
    computedOutput: null,
    timeToFirstTokenMs: null,
    containsErrorStatus: false,
    errorMessage: null,
    models: [],
    totalCost: null,
    nonBilledCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    rootSpanType: null,
    attributes: {},
    traceName: "",
    occurredAt: 0,
    createdAt: ANCHOR_MS,
    updatedAt: ANCHOR_MS,
    LastEventOccurredAt: ANCHOR_MS,
    ...overrides,
  } as TraceSummaryData;
}

describe("the trace times a reader sees", () => {
  describe("given a trace whose only signal is a log record", () => {
    /** @scenario "The trace list shows the same fallback time, not the epoch" */
    it("the list row falls back to the storage anchor", () => {
      const item = mapToTraceListItem(
        summary({ occurredAt: 0, storageAnchorMs: ANCHOR_MS }),
      );

      expect(item.timestamp).toBe(ANCHOR_MS);
    });

    /** @scenario "The trace list shows the same fallback time, not the epoch" */
    it("the drawer header falls back to the storage anchor", () => {
      const header = mapTraceSummaryToHeader(
        summary({ occurredAt: 0, storageAnchorMs: ANCHOR_MS }),
      );

      expect(header.timestamp).toBe(ANCHOR_MS);
    });
  });

  describe("given a trace with a span baseline", () => {
    it("both keep reporting the span baseline", () => {
      const withSpans = summary({
        spanCount: 2,
        occurredAt: ANCHOR_MS + 250,
        storageAnchorMs: ANCHOR_MS,
      });

      expect(mapToTraceListItem(withSpans).timestamp).toBe(ANCHOR_MS + 250);
      expect(mapTraceSummaryToHeader(withSpans).timestamp).toBe(
        ANCHOR_MS + 250,
      );
    });
  });
});
