import { AuthorizedClickHouse } from "@langwatch/clickhouse-client";
import { createTenantId, type ProjectionStoreContext } from "@langwatch/eventing";
import {
  clickHouseClientDouble,
  clickHouseQueryClientDouble,
} from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it, vi } from "vitest";

import { ownProofAuthorizer } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { TraceSummaryStore } from "../../../eventing/trace-summary.store.ts";
import {
  TRACE_SUMMARY_LOOKUP_FORWARD_MS,
  TRACE_SUMMARY_LOOKUP_LOOKBACK_MS,
} from "../../trace-summary.repository.ts";
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

function lookup({ occurredAtMs }: { occurredAtMs?: number }): ProjectionStoreContext {
  return {
    tenantId: createTenantId("tenant-1"),
    aggregateId: "t1",
    ...(occurredAtMs === undefined
      ? {}
      : {
          readWindow: {
            fromMs: occurredAtMs - TRACE_SUMMARY_LOOKUP_LOOKBACK_MS,
            toMs: occurredAtMs + TRACE_SUMMARY_LOOKUP_FORWARD_MS,
          },
        }),
  };
}

describe("given a trace summary lookup anchored on its event's time", () => {
  describe("when the span is live", () => {
    /** @scenario "A live span's lookup finds its trace with only bounded reads" */
    it("finds the trace and bounds every read by OccurredAt", async () => {
      const { store, reads } = storeOver({ storedAtMs: NOW_MS - 60_000 });

      const read = await store.get("t1", lookup({ occurredAtMs: NOW_MS }));

      expect(read.kind).toBe("folded");
      expect(reads.length).toBeGreaterThan(0);
      expect(reads.every(({ sql }) => isBounded(sql))).toBe(true);
    });
  });

  describe("when a 300-day-old span is replayed", () => {
    /** @scenario "A replayed 300-day-old span finds its 300-day-old trace with only bounded reads" */
    it("finds the old trace with every read bounded around the span, not around now", async () => {
      const spanAtMs = NOW_MS - 300 * DAY_MS;
      const { store, reads } = storeOver({ storedAtMs: spanAtMs - 60_000 });

      const read = await store.get("t1", lookup({ occurredAtMs: spanAtMs }));

      expect(read.kind).toBe("folded");
      expect(reads.every(({ sql }) => isBounded(sql))).toBe(true);
      expect(reads.every(({ params }) => Number(params.toMs) < NOW_MS - 200 * DAY_MS)).toBe(true);
    });
  });

  describe("when the anchor sits far outside the trace's time", () => {
    /** @scenario "A lookup anchored far outside its trace's time finds nothing without scanning" */
    it("finds nothing in one bounded read and never resolves unbounded", async () => {
      const { store, reads } = storeOver({ storedAtMs: NOW_MS - 30 * DAY_MS });

      const read = await store.get("t1", lookup({ occurredAtMs: NOW_MS }));

      expect(read.kind).toBe("empty");
      expect(reads).toHaveLength(1);
      expect(isBounded(reads[0]!.sql)).toBe(true);
      expect(reads.some(({ sql }) => isResolve(sql))).toBe(false);
    });
  });

  describe("when the lookup carries no anchor", () => {
    /** @scenario "A lookup with no anchor behaves as before" */
    it("resolves the trace's OccurredAt first and then finds it", async () => {
      const { store, reads } = storeOver({ storedAtMs: NOW_MS - 30 * DAY_MS });

      const read = await store.get("t1", lookup({}));

      expect(read.kind).toBe("folded");
      expect(isResolve(reads[0]!.sql)).toBe(true);
    });
  });
});
