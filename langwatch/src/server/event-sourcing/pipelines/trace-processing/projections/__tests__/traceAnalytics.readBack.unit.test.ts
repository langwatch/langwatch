import { describe, expect, it } from "vitest";
import {
  projectAnalyticsStateToRow,
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  type TraceAnalyticsData,
  TraceAnalyticsFoldProjection,
  type TraceAnalyticsRow,
  traceAnalyticsStateFromRow,
} from "../traceAnalytics.foldProjection";

/**
 * Read-back round-trip for the slim trace fold (ADR-066). `fromRow` is the
 * inverse of the projection: it must reproduce the fold's WORKING state — not
 * just the queryable columns — from the last committed row, so the delivery
 * path never refolds from `event_log`. It is a deserialize, not a rebuild.
 */

const TENANT = "tenant-rb";
const BASE_MS = 1_760_000_000_000;

const projection = new TraceAnalyticsFoldProjection({
  store: { store: async () => {}, get: async () => null },
});

function project(state: TraceAnalyticsData): TraceAnalyticsRow {
  return projectAnalyticsStateToRow({
    state,
    tenantId: TENANT,
    version: TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  });
}

function committedState(): TraceAnalyticsData {
  return {
    ...projection.init(),
    traceId: "trace-rb",
    spanCount: 7,
    topicId: "topic-1",
    subTopicId: "sub-1",
    traceName: "My Trace",
    models: ["gpt-5-mini", "claude-fable-5"],
    occurredAt: BASE_MS,
    totalDurationMs: 4200,
    totalCost: 0.42,
    nonBilledCost: 0.1,
    totalPromptTokenCount: 120,
    totalCompletionTokenCount: 60,
    timeToFirstTokenMs: 350,
    tokensPerSecond: 42,
    containsErrorStatus: true,
    annotationIds: ["ann-a", "ann-b"],
    attributes: {
      "langwatch.user_id": "user-9",
      "gen_ai.conversation.id": "conv-9",
      "langwatch.customer_id": "cust-9",
      "langwatch.origin": "playground",
      "langwatch.labels": JSON.stringify(["alpha", "beta"]),
      "langwatch.reserved.cache_read_tokens": "500",
      "langwatch.reserved.log_record_count": "3",
      "metadata.team": "platform",
      // Payload — dropped by the trim, never read by the fold.
      "gen_ai.prompt": "the whole conversation history that must not persist",
    },
    rootSpanStartTimeMs: BASE_MS - 5,
    traceNameUserOverridden: true,
    traceNameFromFallback: false,
    rootMetadataFromFallback: false,
    createdAt: BASE_MS - 100,
    updatedAt: BASE_MS + 100,
    LastEventOccurredAt: BASE_MS + 50,
  };
}

describe("traceAnalytics read-back (fromRow)", () => {
  describe("given a committed slim row", () => {
    const state = committedState();
    const row = project(state);
    const decoded = traceAnalyticsStateFromRow(row);

    it("recovers the fold bookkeeping the trimmed row would otherwise drop", () => {
      expect(decoded.spanCount).toBe(7);
      expect(decoded.annotationIds).toEqual(["ann-a", "ann-b"]);
      expect(decoded.rootSpanStartTimeMs).toBe(BASE_MS - 5);
      expect(decoded.traceNameUserOverridden).toBe(true);
      expect(decoded.traceNameFromFallback).toBe(false);
      expect(decoded.rootMetadataFromFallback).toBe(false);
      expect(decoded.LastEventOccurredAt).toBe(BASE_MS + 50);
    });

    it("recovers the hoisted dimensions and reserved accumulators", () => {
      expect(decoded.traceName).toBe("My Trace");
      expect(decoded.models).toEqual(["gpt-5-mini", "claude-fable-5"]);
      expect(decoded.totalCost).toBe(0.42);
      expect(decoded.timeToFirstTokenMs).toBe(350);
      // Dimensions are re-injected from their typed columns.
      expect(decoded.attributes["langwatch.origin"]).toBe("playground");
      expect(decoded.attributes["langwatch.user_id"]).toBe("user-9");
      expect(decoded.attributes["langwatch.labels"]).toBe(
        JSON.stringify(["alpha", "beta"]),
      );
      // Reserved accumulators survive the trim by contract.
      expect(decoded.attributes["langwatch.reserved.cache_read_tokens"]).toBe(
        "500",
      );
    });

    it("does not carry payload keys the trim drops back into state", () => {
      expect(decoded.attributes["gen_ai.prompt"]).toBeUndefined();
    });

    it("re-projects to the identical row — read-back is a fixed point", () => {
      // The strongest guarantee: folding nothing new onto the recovered state
      // and writing it back reproduces the row byte-for-byte, so a cache miss
      // followed by a store cannot diverge the persisted analytics.
      expect(project(decoded)).toEqual(row);
    });
  });

  describe("given a pre-migration row whose read-back columns are absent", () => {
    it("decodes with documented defaults instead of refolding", () => {
      const row = project(committedState());
      // A row written before migration 00056 supplies the column defaults.
      const legacyRow: TraceAnalyticsRow = {
        ...row,
        spanCount: 0,
        annotationIds: [],
        rootSpanStartTimeMs: 0,
        traceNameFromFallback: false,
        rootMetadataFromFallback: false,
        traceNameUserOverridden: false,
        lastEventOccurredAt: 0,
      };

      const decoded = traceAnalyticsStateFromRow(legacyRow);

      // The real analytics columns still round-trip.
      expect(decoded.traceName).toBe("My Trace");
      expect(decoded.totalCost).toBe(0.42);
      // The absent read-back columns map to their state defaults — no throw,
      // no refold. 0 root time reads back as "no root claimed yet".
      expect(decoded.rootSpanStartTimeMs).toBeUndefined();
      expect(decoded.annotationIds).toEqual([]);
      expect(decoded.spanCount).toBe(0);
      expect(decoded.LastEventOccurredAt).toBe(0);
    });
  });
});
