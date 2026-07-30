/**
 * @vitest-environment node
 * @integration
 *
 * Round-trips the slim trace_analytics table (migrations 00039 + 00056) through
 * its real INSERT/SELECT SQL against ClickHouse. The unit tests cover the fold
 * derivation and the pure fromRow decoder with no I/O; this proves the
 * DDL↔repository column contract — a mismatched column name or type fails a
 * real insert loudly, which no mock can catch — plus the ADR-066 read-back path:
 * the 00056 columns (span count, annotation id set, name-resolution bookkeeping,
 * the out-of-order checkpoint) survive the trip so store.get() reconstructs
 * working state without touching event_log, the AppliedEventIds watermark
 * survives cache loss, and a pre-00056 row whose body omits the columns decodes
 * with documented defaults rather than refolding.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TraceAnalyticsRow } from "~/server/event-sourcing.old/pipelines/trace-processing/projections/traceAnalytics.foldProjection";
import {
  startTestContainers,
  stopTestContainers,
} from "~/test-utils/integration/testContainers";
import { TraceAnalyticsClickHouseRepository } from "../trace-analytics.clickhouse.repository";

let ch: ClickHouseClient;
let repo: TraceAnalyticsClickHouseRepository;

const tag = nanoid();
const tenantId = `${tag}-project`;
const baseMs = Date.now();
const window = { fromMs: baseMs - 60_000, toMs: baseMs + 60_000 };

function traceRow(over: Partial<TraceAnalyticsRow> = {}): TraceAnalyticsRow {
  return {
    tenantId,
    traceId: `${tag}-t`,
    version: "2026-06-20",
    occurredAtMs: baseMs,
    createdAtMs: baseMs,
    updatedAtMs: baseMs,
    traceName: "My Trace",
    topicId: "topic-1",
    subTopicId: "sub-1",
    userId: "user-9",
    conversationId: "conv-9",
    customerId: "cust-9",
    origin: "playground",
    models: ["gpt-5-mini", "claude-fable-5"],
    labels: ["alpha", "beta"],
    totalCost: 0.42,
    nonBilledCost: 0.1,
    totalDurationMs: 4200,
    timeToFirstTokenMs: 350,
    tokensPerSecond: 42,
    promptTokens: 120,
    completionTokens: 60,
    // CacheReadTokens is Nullable(UInt32) — keep the fixture inside its range.
    cacheReadTokens: 900_000_000,
    cacheWriteTokens: 10,
    reasoningTokens: 5,
    hasError: true,
    hasAnnotation: true,
    attributes: {
      "langwatch.reserved.cache_read_tokens": "900000000",
      "metadata.team": "platform",
    },
    // Read-back state (migration 00056).
    spanCount: 7,
    annotationIds: [`${tag}-ann-a`, `${tag}-ann-b`],
    rootSpanStartTimeMs: baseMs - 5,
    traceNameFromFallback: false,
    rootMetadataFromFallback: false,
    traceNameUserOverridden: true,
    lastEventOccurredAt: baseMs + 50,
    // Span timing baseline (migration 00061), deliberately EARLIER than the
    // anchor in OccurredAt: a late earlier-starting span moved the baseline
    // while the anchor stayed frozen. The two must not swap in the round-trip.
    earliestSpanStartMs: baseMs - 250,
    ...over,
  };
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  repo = new TraceAnalyticsClickHouseRepository(async () => ch);
}, 60_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: `ALTER TABLE trace_analytics DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
  }
  await stopTestContainers();
});

describe("trace_analytics round-trip (migrations 00039 + 00056 + 00061)", () => {
  describe("given a fully populated slim row", () => {
    it("reads back every read-back column so the fold recovers its state", async () => {
      const row = traceRow({ traceId: `${tag}-rt` });
      // Both write paths carry `wait_for_async_insert: 1`, so the row is
      // durably queryable once this resolves — the wait is a correctness
      // requirement for the next delivery's read-back, not a batch-only
      // nicety. The batch path is used here only because it is the store's.
      await repo.upsertBatch([{ row, retentionDays: 30 }]);

      const read = await repo.findByTraceIdWithApplied({
        tenantId,
        traceId: `${tag}-rt`,
        window,
      });

      expect(read).not.toBeNull();
      // Analytics columns.
      expect(read!.row.traceName).toBe("My Trace");
      expect(read!.row.models).toEqual(["gpt-5-mini", "claude-fable-5"]);
      expect(read!.row.labels).toEqual(["alpha", "beta"]);
      expect(read!.row.topicId).toBe("topic-1");
      expect(read!.row.cacheReadTokens).toBe(900_000_000);
      expect(read!.row.attributes["metadata.team"]).toBe("platform");
      // Read-back columns (00056) — exact integer / array / bool round-trip.
      expect(read!.row.spanCount).toBe(7);
      expect(read!.row.annotationIds).toEqual([`${tag}-ann-a`, `${tag}-ann-b`]);
      expect(read!.row.rootSpanStartTimeMs).toBe(baseMs - 5);
      expect(read!.row.traceNameUserOverridden).toBe(true);
      expect(read!.row.traceNameFromFallback).toBe(false);
      expect(read!.row.rootMetadataFromFallback).toBe(false);
      expect(read!.row.lastEventOccurredAt).toBe(baseMs + 50);
      // Span timing baseline (00061) — its own column, exact as a UInt64, and
      // NOT confused with the anchor the partition column carries.
      expect(read!.row.earliestSpanStartMs).toBe(baseMs - 250);
      // Partition/timestamp column is populated (DateTime64 exactness is
      // machine-timezone dependent, so only assert it is present + sane).
      expect(read!.row.occurredAtMs).toBeGreaterThan(0);
    });
  });

  describe("given the same trace written twice", () => {
    it("dedups to the latest version (ReplacingMergeTree, no FINAL)", async () => {
      const row = traceRow({ traceId: `${tag}-dedup`, totalCost: 1 });
      await repo.upsertBatch([{ row, retentionDays: 30 }]);
      // A higher updatedAtMs makes the second write the RMT-latest version
      // (the repo stamps UpdatedAt from row.updatedAtMs, not now()).
      await repo.upsertBatch([
        {
          row: {
            ...row,
            totalCost: 2,
            spanCount: 9,
            updatedAtMs: baseMs + 1000,
          },
          retentionDays: 30,
        },
      ]);

      const read = await repo.findByTraceIdWithApplied({
        tenantId,
        traceId: `${tag}-dedup`,
        window,
      });

      expect(read!.row.totalCost).toBeCloseTo(2);
      expect(read!.row.spanCount).toBe(9);
    });
  });

  describe("given a row written with an applied-event-id watermark", () => {
    it("reads the watermark back next to the row (ADR-066)", async () => {
      const row = traceRow({ traceId: `${tag}-applied` });
      await repo.upsertBatch([
        { row, retentionDays: 30, appliedEventIds: ["ev-1", "ev-2"] },
      ]);

      const read = await repo.findByTraceIdWithApplied({
        tenantId,
        traceId: `${tag}-applied`,
        window,
      });

      expect(read!.appliedEventIds).toEqual(["ev-1", "ev-2"]);
    });
  });

  describe("given a pre-migration row that omits the 00056 columns", () => {
    it("decodes with documented defaults instead of refolding", async () => {
      const traceId = `${tag}-legacy`;
      // A row written before migration 00056 emits a JSONEachRow body with none
      // of the read-back columns, so ClickHouse supplies each column default.
      await ch.insert({
        table: "trace_analytics",
        values: [
          {
            TenantId: tenantId,
            TraceId: traceId,
            Version: "2026-06-20",
            OccurredAt: new Date(baseMs),
            TraceName: "Legacy Trace",
          },
        ],
        format: "JSONEachRow",
      });

      const read = await repo.findByTraceIdWithApplied({
        tenantId,
        traceId,
        window,
      });

      expect(read).not.toBeNull();
      expect(read!.row.traceName).toBe("Legacy Trace");
      // The absent 00056 columns come back as their defaults — never a refold.
      expect(read!.row.spanCount).toBe(0);
      expect(read!.row.annotationIds).toEqual([]);
      expect(read!.row.rootSpanStartTimeMs).toBe(0);
      expect(read!.row.traceNameFromFallback).toBe(false);
      expect(read!.row.lastEventOccurredAt).toBe(0);
      // Same for the 00061 column: the DEFAULT is what a row written before it
      // means, and reading it must not throw the way an Array without a DEFAULT
      // did in the 2026-07-28 incident (migration 00057).
      expect(read!.row.earliestSpanStartMs).toBe(0);
      expect(read!.appliedEventIds).toEqual([]);
    });
  });
});
