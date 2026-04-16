import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  getTestClickHouseClient,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import type { ClickHouseClient } from "@clickhouse/client";

/**
 * Integration tests for trace archival.
 *
 * These tests insert trace data directly into ClickHouse, archive it via
 * ALTER TABLE UPDATE mutations, and verify that all query patterns correctly
 * exclude archived traces.
 */

function generateTestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL || process.env.CI_CLICKHOUSE_URL
);

describe.skipIf(!hasTestcontainers)(
  "trace archival integration",
  () => {
    let ch: ClickHouseClient;
    let tenantId: string;
    let activeTraceId: string;
    let archivedTraceId: string;

    beforeAll(async () => {
      ch = getTestClickHouseClient()!;
      tenantId = generateTestId("tenant");
      activeTraceId = generateTestId("active-trace");
      archivedTraceId = generateTestId("archived-trace");

      const now = new Date();
      const fiveMinAgo = new Date(now.getTime() - 5 * 60_000);

      // Ensure our migration columns exist (reusable containers may have stale schema)
      await ch.command({ query: `ALTER TABLE trace_summaries ADD COLUMN IF NOT EXISTS ArchivedAt Nullable(DateTime64(3))` });
      await ch.command({ query: `ALTER TABLE trace_summaries ADD COLUMN IF NOT EXISTS LastEventOccurredAt DateTime64(3) DEFAULT '1970-01-01 00:00:00.000'` });
      await ch.command({ query: `ALTER TABLE trace_summaries ADD COLUMN IF NOT EXISTS AnnotationIds Array(String) DEFAULT []` });
      await ch.command({ query: `ALTER TABLE trace_summaries ADD COLUMN IF NOT EXISTS ScenarioRoleCosts Map(String, Float64) DEFAULT map()` });
      await ch.command({ query: `ALTER TABLE trace_summaries ADD COLUMN IF NOT EXISTS ScenarioRoleLatencies Map(String, Float64) DEFAULT map()` });
      await ch.command({ query: `ALTER TABLE trace_summaries ADD COLUMN IF NOT EXISTS ScenarioRoleSpans Map(String, String) DEFAULT map()` });
      await ch.command({ query: `ALTER TABLE trace_summaries ADD COLUMN IF NOT EXISTS SpanCosts Map(String, Float64) DEFAULT map()` });
      await ch.command({ query: `ALTER TABLE stored_spans ADD COLUMN IF NOT EXISTS ArchivedAt Nullable(DateTime64(3))` });

      // Insert two trace summaries: one active, one to be archived
      const baseSummary = {
        Version: "2026-04-16",
        Attributes: { "langwatch.origin": "application" },
        OccurredAt: fiveMinAgo,
        CreatedAt: fiveMinAgo,
        UpdatedAt: fiveMinAgo,
        ComputedIOSchemaVersion: "2025-12-18",
        SpanCount: 1,
        TotalDurationMs: 100,
        ContainsErrorStatus: false,
        ContainsOKStatus: true,
        Models: ["gpt-5-mini"],
        TotalCost: 0.001,
        TokensEstimated: false,
        TotalPromptTokenCount: 10,
        TotalCompletionTokenCount: 20,
        TopicId: "topic-1",
      };

      await ch.insert({
        table: "trace_summaries",
        values: [
          {
            ...baseSummary,
            ProjectionId: generateTestId("proj"),
            TenantId: tenantId,
            TraceId: activeTraceId,
            ComputedInput: "hello",
            ComputedOutput: "world",
          },
          {
            ...baseSummary,
            ProjectionId: generateTestId("proj"),
            TenantId: tenantId,
            TraceId: archivedTraceId,
            ComputedInput: "archive me",
            ComputedOutput: "goodbye",
            TotalDurationMs: 200,
            TotalCost: 0.002,
          },
        ],
        format: "JSONEachRow",
      });

      // Insert stored_spans for both traces
      await ch.insert({
        table: "stored_spans",
        values: [
          {
            TenantId: tenantId,
            TraceId: activeTraceId,
            SpanId: generateTestId("span"),
            Sampled: 1,
            StartTime: fiveMinAgo,
            EndTime: now,
            DurationMs: 100,
            SpanName: "active-span",
            SpanKind: 1,
            ResourceAttributes: {},
            SpanAttributes: { "langwatch.span.type": "llm" },
            StatusCode: 1,
            ScopeName: "test",
          },
          {
            TenantId: tenantId,
            TraceId: archivedTraceId,
            SpanId: generateTestId("span"),
            Sampled: 1,
            StartTime: fiveMinAgo,
            EndTime: now,
            DurationMs: 200,
            SpanName: "archived-span",
            SpanKind: 1,
            ResourceAttributes: {},
            SpanAttributes: { "langwatch.span.type": "llm" },
            StatusCode: 1,
            ScopeName: "test",
          },
        ],
        format: "JSONEachRow",
      });

      // Wait for ClickHouse to flush async inserts and verify data landed
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify both traces exist before archiving
      const verifyResult = await ch.query({
        query: `SELECT count(DISTINCT TraceId) AS cnt FROM trace_summaries FINAL WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId },
        format: "JSONEachRow",
      });
      const verifyRows = await verifyResult.json<{ cnt: string }>();
      if (Number(verifyRows[0]?.cnt) < 2) {
        throw new Error(`Expected 2 traces, got ${verifyRows[0]?.cnt}. Data may not have flushed yet.`);
      }

      // Archive one trace: insert a new row with ArchivedAt set and a newer UpdatedAt
      const archiveNow = new Date();
      await ch.insert({
        table: "trace_summaries",
        values: [{
          ...baseSummary,
          ProjectionId: generateTestId("proj-archived"),
          TenantId: tenantId,
          TraceId: archivedTraceId,
          ComputedInput: "archive me",
          ComputedOutput: "goodbye",
          TotalDurationMs: 200,
          TotalCost: 0.002,
          UpdatedAt: archiveNow,
          ArchivedAt: archiveNow,
        }],
        format: "JSONEachRow",
      });

      await ch.command({
        query: `
          ALTER TABLE stored_spans
          UPDATE ArchivedAt = now64(3)
          WHERE TenantId = '${tenantId}'
            AND TraceId = '${archivedTraceId}'
            AND ArchivedAt IS NULL
        `,
      });

      // Wait for stored_spans mutations to complete.
      // IMPORTANT: we deliberately do NOT call OPTIMIZE TABLE ... FINAL here.
      // Production queries must handle the pre-merge state (two rows per archived
      // trace, one unarchived + one archived) by using dedup subqueries that pick
      // the latest row via max(UpdatedAt). These tests run in the unmerged state
      // so they exercise that code path.
      await waitForMutations(ch, "stored_spans");
    });

    afterEach(async () => {
      // Individual test cleanup not needed — data is tenant-scoped
    });

    it("excludes archived traces from count queries (dedup, unmerged data)", async () => {
      // Production queries dedup via max(UpdatedAt) subquery so archival is
      // visible immediately — before the ReplacingMergeTree merge runs.
      // NOTE: The inner max(UpdatedAt) subquery must NOT filter ArchivedAt,
      // otherwise older unarchived versions leak through when the latest
      // version is archived (see PR #3272 review).
      const result = await ch.query({
        query: `
          SELECT count() AS total
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND ArchivedAt IS NULL
            AND (TenantId, TraceId, UpdatedAt) IN (
              SELECT TenantId, TraceId, max(UpdatedAt)
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
              GROUP BY TenantId, TraceId
            )
        `,
        query_params: { tenantId },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ total: string }>();
      expect(Number(rows[0]?.total)).toBe(1);
    });

    it("excludes archived traces from dedup queries (pre-merge semantics)", async () => {
      // CRITICAL: inner max(UpdatedAt) subquery must NOT filter ArchivedAt.
      // Otherwise, for a trace whose latest row is archived, the max picks
      // an older unarchived row and the trace leaks back into results.
      const result = await ch.query({
        query: `
          SELECT TraceId
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND ArchivedAt IS NULL
            AND (TenantId, TraceId, UpdatedAt) IN (
              SELECT TenantId, TraceId, max(UpdatedAt)
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
              GROUP BY TenantId, TraceId
            )
        `,
        query_params: { tenantId },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ TraceId: string }>();
      const traceIds = rows.map((r) => r.TraceId);

      expect(traceIds).toContain(activeTraceId);
      expect(traceIds).not.toContain(archivedTraceId);
    });

    it("broken dedup pattern (ArchivedAt in inner subquery) would leak archived trace", async () => {
      // Regression guard: the anti-pattern described in the PR review.
      // If this test ever shows archivedTraceId, someone has reintroduced the
      // bug where ArchivedAt filtering inside the max(UpdatedAt) subquery
      // causes older unarchived versions to be selected. The correct pattern
      // is covered by the sibling "pre-merge semantics" test above.
      const result = await ch.query({
        query: `
          SELECT TraceId
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND ArchivedAt IS NULL
            AND (TenantId, TraceId, UpdatedAt) IN (
              SELECT TenantId, TraceId, max(UpdatedAt)
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
                AND ArchivedAt IS NULL
              GROUP BY TenantId, TraceId
            )
        `,
        query_params: { tenantId },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ TraceId: string }>();
      const traceIds = rows.map((r) => r.TraceId);

      // This is the broken behaviour — archivedTraceId DOES leak through
      // because we fed the dedup from a filtered set. Encoded as a test so
      // the failure mode is visible and cannot be silently restored.
      expect(traceIds).toContain(activeTraceId);
      expect(traceIds).toContain(archivedTraceId);
    });

    it("excludes archived traces from topic count queries (dedup, unmerged data)", async () => {
      const result = await ch.query({
        query: `
          SELECT TopicId, count() AS cnt
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND ArchivedAt IS NULL
            AND TopicId IS NOT NULL
            AND (TenantId, TraceId, UpdatedAt) IN (
              SELECT TenantId, TraceId, max(UpdatedAt)
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
              GROUP BY TenantId, TraceId
            )
          GROUP BY TopicId
        `,
        query_params: { tenantId },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ TopicId: string; cnt: string }>();
      // Only 1 trace should be counted (the active one) even in pre-merge state
      expect(Number(rows[0]?.cnt)).toBe(1);
    });

    it("excludes archived spans from stored_spans queries", async () => {
      const result = await ch.query({
        query: `
          SELECT SpanName, TraceId
          FROM stored_spans
          WHERE TenantId = {tenantId:String}
            AND ArchivedAt IS NULL
        `,
        query_params: { tenantId },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ SpanName: string; TraceId: string }>();
      const spanNames = rows.map((r) => r.SpanName);
      const traceIds = rows.map((r) => r.TraceId);

      expect(spanNames).toContain("active-span");
      expect(spanNames).not.toContain("archived-span");
      expect(traceIds).not.toContain(archivedTraceId);
    });

    it("archived trace data still exists (soft delete)", async () => {
      // Without ArchivedAt filter, both traces should be visible
      const result = await ch.query({
        query: `
          SELECT count(DISTINCT TraceId) AS total
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
        `,
        query_params: { tenantId },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ total: string }>();
      // Both traces exist — data is not deleted
      expect(Number(rows[0]?.total)).toBe(2);
    });

    it("archived trace has non-null ArchivedAt", async () => {
      const result = await ch.query({
        query: `
          SELECT TraceId, ArchivedAt
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND TraceId = {traceId:String}
            AND ArchivedAt IS NOT NULL
        `,
        query_params: { tenantId, traceId: archivedTraceId },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ TraceId: string; ArchivedAt: string }>();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.TraceId).toBe(archivedTraceId);
    });

    it("active trace has null ArchivedAt", async () => {
      const result = await ch.query({
        query: `
          SELECT TraceId, ArchivedAt
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND TraceId = {traceId:String}
            AND ArchivedAt IS NULL
        `,
        query_params: { tenantId, traceId: activeTraceId },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ TraceId: string }>();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.TraceId).toBe(activeTraceId);
    });

    it("excludes archived traces from thread queries", async () => {
      // Insert a trace with a thread ID for both active and archived
      const threadId = generateTestId("thread");
      const activeThreadTrace = generateTestId("active-thread");
      const archivedThreadTrace = generateTestId("archived-thread");
      const now = new Date();

      await ch.insert({
        table: "trace_summaries",
        values: [
          makeMinimalSummary(tenantId, activeThreadTrace, now, {
            "gen_ai.conversation.id": threadId,
          }),
          makeMinimalSummary(tenantId, archivedThreadTrace, now, {
            "gen_ai.conversation.id": threadId,
          }),
        ],
        format: "JSONEachRow",
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Archive one via direct INSERT with newer UpdatedAt and ArchivedAt set
      const archiveNow = new Date();
      await ch.insert({
        table: "trace_summaries",
        values: [{
          ...makeMinimalSummary(tenantId, archivedThreadTrace, now, {
            "gen_ai.conversation.id": threadId,
          }),
          UpdatedAt: archiveNow,
          ArchivedAt: archiveNow,
        }],
        format: "JSONEachRow",
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Query by thread ID in pre-merge state using the production dedup pattern.
      // Inner max(UpdatedAt) must NOT filter ArchivedAt (see PR #3272 review).
      const result = await ch.query({
        query: `
          SELECT DISTINCT TraceId
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND ArchivedAt IS NULL
            AND Attributes['gen_ai.conversation.id'] = {threadId:String}
            AND (TenantId, TraceId, UpdatedAt) IN (
              SELECT TenantId, TraceId, max(UpdatedAt)
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
              GROUP BY TenantId, TraceId
            )
        `,
        query_params: { tenantId, threadId },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ TraceId: string }>();
      const traceIds = rows.map((r) => r.TraceId);

      expect(traceIds).toContain(activeThreadTrace);
      expect(traceIds).not.toContain(archivedThreadTrace);
    });

    it("excludes archived traces from paginated queries with argMax dedup (pre-merge)", async () => {
      // argMax must be applied over UNFILTERED rows so it resolves the latest
      // version, then the outer query filters on the archived state of that
      // latest version. Filtering ArchivedAt IS NULL before argMax would
      // cause argMax to pick an older unarchived version and leak the trace.
      const result = await ch.query({
        query: `
          SELECT TraceId
          FROM (
            SELECT TraceId,
                   argMax(OccurredAt, UpdatedAt) AS _oa,
                   argMax(ArchivedAt, UpdatedAt) AS _archived
            FROM trace_summaries
            WHERE TenantId = {tenantId:String}
            GROUP BY TraceId
          )
          WHERE _archived IS NULL
          ORDER BY _oa DESC
        `,
        query_params: { tenantId },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ TraceId: string }>();
      const traceIds = rows.map((r) => r.TraceId);

      expect(traceIds).toContain(activeTraceId);
      expect(traceIds).not.toContain(archivedTraceId);
    });
  },
);

// --- Helpers ---

function makeMinimalSummary(
  tenantId: string,
  traceId: string,
  at: Date,
  attributes: Record<string, string> = {},
) {
  return {
    ProjectionId: generateTestId("proj"),
    TenantId: tenantId,
    TraceId: traceId,
    Version: "2026-04-16",
    Attributes: attributes,
    OccurredAt: at,
    CreatedAt: at,
    UpdatedAt: at,
    LastEventOccurredAt: at,
    ComputedIOSchemaVersion: "2025-12-18",
    ComputedInput: null,
    ComputedOutput: null,
    SpanCount: 0,
    TotalDurationMs: 0,
    ContainsErrorStatus: 0,
    ContainsOKStatus: 0,
    Models: [],
    TotalCost: null,
    TokensEstimated: false,
    TotalPromptTokenCount: null,
    TotalCompletionTokenCount: null,
    OutputFromRootSpan: 0,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: 0,
    TopicId: null,
    SubTopicId: null,
    AnnotationIds: [],
    HasAnnotation: 0,
    ScenarioRoleCosts: {},
    ScenarioRoleLatencies: {},
    ScenarioRoleSpans: {},
    SpanCosts: {},
    ArchivedAt: null,
  };
}

async function waitForMutations(
  ch: ClickHouseClient,
  table: string,
  timeoutMs = 30000,
): Promise<void> {
  // Scope polling to the specific table under test so an unrelated suite
  // running against a shared ClickHouse container cannot block or timeout us.
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await ch.query({
      query: `
        SELECT count() AS pending
        FROM system.mutations
        WHERE is_done = 0
          AND database = currentDatabase()
          AND table = {table:String}
      `,
      query_params: { table },
      format: "JSONEachRow",
    });
    const rows = await result.json<{ pending: string }>();
    if (Number(rows[0]?.pending ?? 0) === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `Timeout waiting for ClickHouse mutations on ${table} to complete`,
  );
}
