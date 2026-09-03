import { describe, expect, it } from "vitest";
import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service";
import {
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT,
  TraceAnalyticsFoldProjection,
  type TraceAnalyticsData,
  type TraceAnalyticsRow,
} from "../trace-derived.projection";
import { createTestRuntime } from "./fixtures/trace-summary-test.fixtures";

/**
 * Read-back of a PRE-SPLIT row (migration 00061): before `storageAnchorMs`
 * existed as its own column, `OccurredAt` carried both jobs at once — the
 * partition/TTL anchor AND the span timing baseline `SpanTimingService`
 * measures duration from. Decoding a row stamped at that version has to take
 * BOTH from that one column, or a population recorded before the split would
 * either move its own partition (re-anchoring) or restart its duration.
 */

const TENANT = "tenant-rb";
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

function committedState(): TraceAnalyticsData {
  return {
    ...projection.init(),
    traceId: "trace-rb",
    // Deliberately LATER than storageAnchorMs would be on a post-split row —
    // on THIS fixture the two collapse onto the one pre-split column, so the
    // committed row before the version override carries them apart to prove
    // the decoder does not accidentally read the right value for the wrong
    // reason.
    storageAnchorMs: BASE_MS + 250,
    occurredAt: BASE_MS,
  };
}

/**
 * The one older stamp that is decoded rather than refused. On a pre-split row
 * `OccurredAt` is `min(span start)` — at once a valid anchor (it is what the
 * row is already partitioned and TTL'd on) and the correct span timing
 * baseline (it is what the new column was split out to carry).
 */
function preSplitRow(over: Partial<TraceAnalyticsRow> = {}): TraceAnalyticsRow {
  return {
    ...project(committedState()),
    version: TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT,
    // The column this shape does not have. Its ClickHouse DEFAULT is 0, so
    // that is what a real pre-split row decodes as.
    earliestSpanStartMs: 0,
    occurredAtMs: BASE_MS + 250,
    ...over,
  };
}

describe("traceAnalytics read-back of a pre-split row", () => {
  describe("given a row stamped with the version just before the anchor split", () => {
    /** @scenario A trace recorded before the upgrade keeps its place in the timeline */
    it("takes the timing baseline from the anchor's column, because there they are the same value", () => {
      const state = TraceAnalyticsFoldProjection.traceAnalyticsStateFromRow(preSplitRow());

      // Both read off OccurredAt: pre-split, that column WAS min(span start).
      expect(state.storageAnchorMs).toBe(BASE_MS + 250);
      expect(state.occurredAt).toBe(BASE_MS + 250);
    });

    /** @scenario A trace recorded before the upgrade keeps its place in the timeline */
    it("keeps the anchor exactly where the row was already stored", () => {
      // The point of decoding rather than refolding: re-projecting the decoded
      // state must reproduce the same partition column, so the row is rewritten
      // onto its own sort key rather than a second one.
      const rewritten = project(
        TraceAnalyticsFoldProjection.traceAnalyticsStateFromRow(preSplitRow()),
      );

      expect(rewritten.occurredAtMs).toBe(BASE_MS + 250);
    });
  });
});
