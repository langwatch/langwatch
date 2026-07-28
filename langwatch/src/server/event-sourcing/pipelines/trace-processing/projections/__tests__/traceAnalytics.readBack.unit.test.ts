import { describe, expect, it, vi } from "vitest";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import {
  projectAnalyticsStateToRow,
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  type TraceAnalyticsData,
  TraceAnalyticsFoldProjection,
  type TraceAnalyticsRow,
  traceAnalyticsStateFromRow,
} from "../traceAnalytics.foldProjection";
import { TraceAnalyticsStore } from "../traceAnalytics.store";

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
    it("stays total, mapping the absent columns to their state defaults", () => {
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
      // The absent read-back columns map to their state defaults — the decoder
      // never throws. 0 root time reads back as "no root claimed yet". Whether
      // such a row may be decoded AT ALL is the store's call, not this
      // function's — see the version-gate tests below.
      expect(decoded.rootSpanStartTimeMs).toBeUndefined();
      expect(decoded.annotationIds).toEqual([]);
      expect(decoded.spanCount).toBe(0);
      expect(decoded.LastEventOccurredAt).toBe(0);
    });
  });
});

describe("TraceAnalyticsStore read-back version gate", () => {
  const context = {
    aggregateId: "trace-rb",
    tenantId: createTenantId(TENANT),
  } as unknown as ProjectionStoreContext;

  function storeOver(row: TraceAnalyticsRow) {
    const findByTraceIdWithApplied = vi
      .fn()
      .mockResolvedValue({ row, appliedEventIds: ["evt-1", "evt-2"] });
    const store = new TraceAnalyticsStore({
      findByTraceIdWithApplied,
    } as unknown as ConstructorParameters<typeof TraceAnalyticsStore>[0]);
    return { store, findByTraceIdWithApplied };
  }

  describe("given a row stamped with the current projection version", () => {
    it("reads the state and the durable watermark back", async () => {
      const { store } = storeOver(project(committedState()));

      const { state, appliedEventIds } = await store.getWithApplied(
        "trace-rb",
        context,
      );

      expect(state?.spanCount).toBe(7);
      expect(state?.traceNameUserOverridden).toBe(true);
      expect(appliedEventIds).toEqual(["evt-1", "evt-2"]);
    });
  });

  describe("given a row stamped with an older projection version", () => {
    // Such a row predates the read-back columns, so every one of them decodes
    // as a ClickHouse default indistinguishable from a real value — spanCount 0
    // would re-add committed cost past the span cap, and a false
    // traceNameUserOverridden would let a late span overwrite a user's rename.
    const staleRow = (): TraceAnalyticsRow => ({
      ...project(committedState()),
      version: "2026-06-20",
      spanCount: 0,
      annotationIds: [],
      rootSpanStartTimeMs: 0,
      traceNameUserOverridden: false,
      lastEventOccurredAt: 0,
    });

    it("reports a store miss so the fold refolds instead of trusting it", async () => {
      const { store } = storeOver(staleRow());

      const { state, appliedEventIds } = await store.getWithApplied(
        "trace-rb",
        context,
      );

      expect(state).toBeNull();
      // The watermark goes with the state: keeping it would suppress the very
      // events the re-fold needs to see.
      expect(appliedEventIds).toEqual([]);
    });

    it("misses through get() too, so both read paths agree", async () => {
      const { store } = storeOver(staleRow());

      expect(await store.get("trace-rb", context)).toBeNull();
    });
  });
});
