import { AuthorizedClickHouse } from "@langwatch/clickhouse-client";
import {
  clickHouseClientDouble,
  clickHouseQueryClientDouble,
} from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it, vi } from "vitest";

import { ownProofAuthorizer } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { FoldedTraceSummaryReader } from "../../../app/trace.app.ts";
import { TraceSummaryStore } from "../../../eventing/trace-summary.store.ts";
import { TraceSummaryProjectionClickHouseRepository } from "../trace-summary.repository.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = Date.UTC(2026, 9, 10, 12);

const isResolve = (sql: string) => sql.includes("count() AS rowCount");
const isBounded = (sql: string) => sql.includes("OccurredAt >= fromUnixTimestamp64Milli");

/** One stored trace_summaries row, answered only when a read's bounds cover its OccurredAt. */
function storeOver({ storedAtMs }: { storedAtMs: number }) {
  const reads: { sql: string; params: Record<string, unknown> }[] = [];
  const row = {
    ProjectionId: "p1",
    TenantId: "tenant-1",
    TraceId: "t1",
    Version: "v1",
    Attributes: {},
    OccurredAt: String(storedAtMs),
    EarliestSpanStartMs: String(storedAtMs),
    CreatedAt: String(storedAtMs),
    UpdatedAt: String(storedAtMs),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: null,
    ComputedOutput: null,
    TimeToFirstTokenMs: null,
    TimeToLastTokenMs: null,
    TotalDurationMs: "0",
    TokensPerSecond: null,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: false,
    ErrorMessage: null,
    Models: [],
    TotalCost: null,
    NonBilledCost: null,
    UnpricedSpanCount: 0,
    UnpricedModels: [],
    TokensEstimated: false,
    TotalPromptTokenCount: null,
    TotalCompletionTokenCount: null,
    OutputFromRootSpan: false,
    OutputSpanEndTimeMs: "0",
    BlockedByGuardrail: false,
    RootSpanType: null,
    ContainsAi: false,
    ContainsPrompt: false,
    SelectedPromptId: null,
    SelectedPromptSpanId: null,
    LastUsedPromptId: null,
    LastUsedPromptVersionNumber: null,
    LastUsedPromptVersionId: null,
    LastUsedPromptSpanId: null,
    TopicId: null,
    SubTopicId: null,
    AnnotationIds: [],
    HasAnnotation: null,
    TraceName: "",
  };
  const client = clickHouseQueryClientDouble({
    query: vi.fn(async ({ sql, params }: { sql: string; params?: Record<string, unknown> }) => {
      reads.push({ sql, params: params ?? {} });
      if (isResolve(sql)) return { rows: [{ rowCount: "1", occurredAtMs: String(storedAtMs) }] };
      if (!isBounded(sql)) return { rows: [row] };
      const covers = Number(params?.fromMs) <= storedAtMs && storedAtMs <= Number(params?.toMs);
      return { rows: covers ? [row] : [] };
    }),
  });
  const store = TraceSummaryStore.create({
    storage: TraceSummaryProjectionClickHouseRepository.create({
      resolveClient: async () => clickHouseClientDouble(),
      clickhouse: new AuthorizedClickHouse({ resolveClient: async () => client }),
    }),
    defaultRetentionDays: () => 30,
    authorize: ownProofAuthorizer,
  });
  return { store, reads };
}

const readBack = (sql: string, params: Record<string, unknown>) =>
  isBounded(sql) ? Math.round((NOW_MS - Number(params.fromMs)) / DAY_MS) : null;

describe("given a trace summary lookup anchored on its event's time", () => {
  describe("when the trace sits in the narrowest window", () => {
    /** @scenario "A trace found in the narrowest window takes one read" */
    it("finds it in one read, three days back and one day forward", async () => {
      const { store, reads } = storeOver({ storedAtMs: NOW_MS - 60_000 });

      const summary = await FoldedTraceSummaryReader.create(store).findSummary({
        tenantId: "tenant-1",
        traceId: "t1",
        occurredAtMs: NOW_MS,
      });

      expect(summary).not.toBeNull();
      expect(reads).toHaveLength(1);
      expect(reads[0]!.params).toMatchObject({
        fromMs: NOW_MS - 3 * DAY_MS,
        toMs: NOW_MS + DAY_MS,
      });
    });
  });

  describe("when the trace sits 20 days before its anchor", () => {
    /** @scenario "A trace 20 days before its anchor is found on the 21-day step" */
    it("finds it on the third step after reading 3, 7 and 21 days back", async () => {
      const { store, reads } = storeOver({ storedAtMs: NOW_MS - 20 * DAY_MS });

      const summary = await FoldedTraceSummaryReader.create(store).findSummary({
        tenantId: "tenant-1",
        traceId: "t1",
        occurredAtMs: NOW_MS,
      });

      expect(summary).not.toBeNull();
      expect(reads.map(({ sql, params }) => readBack(sql, params))).toEqual([3, 7, 21]);
      expect(reads.slice(1).map(({ params }) => Number(params.toMs))).toEqual(
        reads.slice(0, -1).map(({ params }) => Number(params.fromMs) - 1),
      );
    });
  });

  describe("when the trace sits 40 days before its anchor", () => {
    /** @scenario "A trace 40 days before its anchor is final not-found after the 30-day step" */
    it("finds nothing after the 30-day step and never resolves", async () => {
      const { store, reads } = storeOver({ storedAtMs: NOW_MS - 40 * DAY_MS });

      const summary = await FoldedTraceSummaryReader.create(store).findSummary({
        tenantId: "tenant-1",
        traceId: "t1",
        occurredAtMs: NOW_MS,
      });

      expect(summary).toBeNull();
      expect(reads.map(({ sql, params }) => readBack(sql, params))).toEqual([3, 7, 21, 30]);
      const coveredMs = reads.reduce(
        (sum, { params }) => sum + Number(params.toMs) - Number(params.fromMs) + 1,
        0,
      );
      expect(coveredMs).toBe(31 * DAY_MS + 1);
      expect(reads.some(({ sql }) => isResolve(sql))).toBe(false);
    });
  });

  describe("when a 300-day-old span is replayed", () => {
    /** @scenario "A replayed 300-day-old span finds its 300-day-old trace with only bounded reads" */
    it("finds the old trace with every read bounded around the span, not around now", async () => {
      const spanAtMs = NOW_MS - 300 * DAY_MS;
      const { store, reads } = storeOver({ storedAtMs: spanAtMs - 60_000 });

      const summary = await FoldedTraceSummaryReader.create(store).findSummary({
        tenantId: "tenant-1",
        traceId: "t1",
        occurredAtMs: spanAtMs,
      });

      expect(summary).not.toBeNull();
      expect(reads.every(({ sql }) => isBounded(sql))).toBe(true);
      expect(reads.every(({ params }) => Number(params.toMs) < NOW_MS - 200 * DAY_MS)).toBe(true);
    });
  });

  describe("when lookups span every distance from their anchors", () => {
    /** @scenario "No anchored lookup ever makes an unbounded read" */
    it.each([0, 2, 5, 20, 29, 31, 40, 300])(
      "bounds every read of a trace %i days back to at most four steps within 30 days",
      async (daysBack) => {
        const { store, reads } = storeOver({ storedAtMs: NOW_MS - daysBack * DAY_MS - 60_000 });

        await FoldedTraceSummaryReader.create(store).findSummary({
          tenantId: "tenant-1",
          traceId: "t1",
          occurredAtMs: NOW_MS,
        });

        expect(reads.length).toBeLessThanOrEqual(4);
        expect(reads.every(({ sql }) => isBounded(sql))).toBe(true);
        expect(reads.every(({ params }) => Number(params.fromMs) >= NOW_MS - 30 * DAY_MS)).toBe(
          true,
        );
      },
    );
  });

  describe("when the lookup asks not to widen", () => {
    /** @scenario "A lookup that does not widen reads only the first slice" */
    it("reads the first slice once and misses a trace 20 days back", async () => {
      const { store, reads } = storeOver({ storedAtMs: NOW_MS - 20 * DAY_MS });

      const summary = await FoldedTraceSummaryReader.create(store).findSummary({
        tenantId: "tenant-1",
        traceId: "t1",
        occurredAtMs: NOW_MS,
        widen: false,
      });

      expect(summary).toBeNull();
      expect(reads).toHaveLength(1);
      expect(reads[0]!.params).toMatchObject({
        fromMs: NOW_MS - 3 * DAY_MS,
        toMs: NOW_MS + DAY_MS,
      });
    });
  });

  describe("when the lookup carries no anchor", () => {
    /** @scenario "A lookup with no anchor behaves as before" */
    it("resolves the trace's OccurredAt first and then finds it", async () => {
      const { store, reads } = storeOver({ storedAtMs: NOW_MS - 30 * DAY_MS });

      const summary = await FoldedTraceSummaryReader.create(store).findSummary({
        tenantId: "tenant-1",
        traceId: "t1",
      });

      expect(summary).not.toBeNull();
      expect(isResolve(reads[0]!.sql)).toBe(true);
    });
  });
});
