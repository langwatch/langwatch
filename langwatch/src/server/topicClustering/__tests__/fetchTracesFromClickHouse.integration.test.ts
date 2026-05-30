/**
 * Integration coverage for the topic-clustering trace fetch against a real
 * ClickHouse.
 *
 * The pre-fix query read `ComputedInput` (a potentially large payload) for
 * the entire deduped 12-month trace set before `ORDER BY ... LIMIT 2000`
 * trimmed it. On busy tenants that materialised gigabytes of payload and the
 * query died with MEMORY_LIMIT_EXCEEDED (observed in prod).
 *
 * The fix pages the 2000 most-recent trace keys first (lightweight columns
 * only) and reads `ComputedInput` for that bounded set alone.
 *
 * Two layers here:
 *  - correctness: `fetchTracesFromClickHouse` returns the right latest-version
 *    traces, newest first, respecting the search cursor.
 *  - memory: the paged query's peak memory (read from `system.query_log`) is a
 *    fraction of the pre-fix whole-set read on the same data. Both queries run
 *    to completion and drain — we measure memory rather than tripping an OOM,
 *    so the test can't leave a half-read socket wedging the worker.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { wrapWithDefaultSettings } from "~/server/clickhouse/safeClickhouseClient";
import {
  cleanupTestData,
  getTestClickHouseClient,
} from "../../event-sourcing/__tests__/integration/testContainers";
import { fetchTracesFromClickHouse } from "../topicClustering";

const TENANT_ID = "topic-fetch-test";
const N_TRACES = 20_000;
const INPUT_BYTES = 4096; // heavy payload — the column we must not read in bulk
const twelveMonthsAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;

async function seedTraceSummaries(ch: ClickHouseClient) {
  const now = Date.now();
  const bigInput = JSON.stringify("x".repeat(INPUT_BYTES));
  const BATCH = 2000;
  let batch: Array<Record<string, unknown>> = [];
  const flush = async () => {
    if (!batch.length) return;
    await ch.insert({
      table: "trace_summaries",
      values: batch,
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
    batch = [];
  };
  for (let i = 0; i < N_TRACES; i++) {
    batch.push({
      ProjectionId: `proj-${nanoid()}`,
      TenantId: TENANT_ID,
      TraceId: `${TENANT_ID}-trace-${String(i).padStart(6, "0")}`,
      Version: "v1",
      Attributes: {},
      // Spread across the last ~weeks; newest = lowest index.
      OccurredAt: new Date(now - i * 60_000),
      CreatedAt: new Date(now),
      UpdatedAt: new Date(now - i),
      ComputedIOSchemaVersion: "",
      ComputedInput: bigInput,
      ComputedOutput: "out",
      TimeToFirstTokenMs: 1,
      TimeToLastTokenMs: 1,
      TotalDurationMs: 1,
      TokensPerSecond: 1,
      SpanCount: 1,
      ContainsErrorStatus: 0,
      ContainsOKStatus: 1,
      ErrorMessage: null,
      Models: ["gpt-5-mini"],
      TotalCost: 0.01,
      TokensEstimated: false,
      TotalPromptTokenCount: 1,
      TotalCompletionTokenCount: 1,
      OutputFromRootSpan: 0,
      OutputSpanEndTimeMs: 0,
      BlockedByGuardrail: 0,
      TopicId: i % 3 === 0 ? `topic-${i % 5}` : null,
      SubTopicId: null,
      HasAnnotation: null,
    });
    if (batch.length >= BATCH) await flush();
  }
  await flush();
}

/** Run a query to completion under a stable query_id and return its peak memory. */
async function peakMemoryBytes(
  ch: ClickHouseClient,
  sql: string,
): Promise<number> {
  const queryId = `mem-${nanoid()}`;
  const r = await ch.query({
    query: sql,
    query_params: { tenantId: TENANT_ID, twelveMonthsAgo },
    format: "JSONEachRow",
    query_id: queryId,
  });
  await r.json(); // fully drain
  await ch.command({ query: "SYSTEM FLUSH LOGS" });
  const log = await ch.query({
    query: `
      SELECT max(memory_usage) AS mem
      FROM system.query_log
      WHERE query_id = {queryId:String} AND type = 'QueryFinish'`,
    query_params: { queryId },
    format: "JSONEachRow",
  });
  const rows = (await log.json()) as Array<{ mem: string }>;
  return Number(rows[0]?.mem ?? 0);
}

const PAGED_SQL = `
  WITH page AS (
    SELECT TraceId FROM trace_summaries
    WHERE TenantId = {tenantId:String} AND OccurredAt >= fromUnixTimestamp64Milli({twelveMonthsAgo:UInt64}) AND OccurredAt < now64(3)
    GROUP BY TenantId, TraceId
    ORDER BY argMax(OccurredAt, UpdatedAt) DESC, TraceId ASC
    LIMIT 2000)
  SELECT t.TraceId, t.ComputedInput, t.TopicId, t.SubTopicId, toString(toUnixTimestamp64Milli(t.OccurredAt)) AS OccurredAtMs
  FROM trace_summaries t
  WHERE TenantId = {tenantId:String} AND OccurredAt >= fromUnixTimestamp64Milli({twelveMonthsAgo:UInt64}) AND OccurredAt < now64(3)
    AND (t.TenantId, t.TraceId, t.UpdatedAt) IN (
      SELECT TenantId, TraceId, max(UpdatedAt) FROM trace_summaries
      WHERE TenantId = {tenantId:String} AND OccurredAt >= fromUnixTimestamp64Milli({twelveMonthsAgo:UInt64}) AND OccurredAt < now64(3)
        AND TraceId IN (SELECT TraceId FROM page)
      GROUP BY TenantId, TraceId)
  ORDER BY t.OccurredAt DESC, t.TraceId ASC LIMIT 2000`;

const PRE_FIX_SQL = `
  SELECT t.TraceId, t.ComputedInput, t.TopicId, t.SubTopicId, toString(toUnixTimestamp64Milli(t.OccurredAt)) AS OccurredAtMs
  FROM trace_summaries t
  WHERE TenantId = {tenantId:String} AND OccurredAt >= fromUnixTimestamp64Milli({twelveMonthsAgo:UInt64}) AND OccurredAt < now64(3)
    AND ComputedInput IS NOT NULL AND ComputedInput != ''
    AND (t.TenantId, t.TraceId, t.UpdatedAt) IN (
      SELECT TenantId, TraceId, max(UpdatedAt) FROM trace_summaries
      WHERE TenantId = {tenantId:String} AND OccurredAt >= fromUnixTimestamp64Milli({twelveMonthsAgo:UInt64}) AND OccurredAt < now64(3)
        AND ComputedInput IS NOT NULL AND ComputedInput != ''
      GROUP BY TenantId, TraceId)
  ORDER BY t.OccurredAt DESC, t.TraceId ASC LIMIT 2000`;

describe("fetchTracesFromClickHouse integration", () => {
  let ch: ClickHouseClient;

  beforeAll(async () => {
    const raw = getTestClickHouseClient();
    if (!raw) throw new Error("ClickHouse client not available");
    ch = wrapWithDefaultSettings(raw);
    await seedTraceSummaries(ch);
  }, 180_000);

  afterAll(async () => {
    await cleanupTestData(TENANT_ID);
  });

  describe("when fetching a full batch", () => {
    it("returns the 2000 newest traces, newest first, all with input", async () => {
      const res = await fetchTracesFromClickHouse(ch, TENANT_ID, false, [], []);

      expect(res.traces).toHaveLength(2000);
      expect(res.returnedCount).toBe(2000);
      expect(res.traces.every((t) => t.input.length > 0)).toBe(true);
      expect(res.traces[0]?.trace_id).toBe(`${TENANT_ID}-trace-000000`);
      expect(res.lastSort).toBeDefined();
    });
  });

  describe("when the search cursor advances", () => {
    it("returns strictly older, non-overlapping traces", async () => {
      const first = await fetchTracesFromClickHouse(ch, TENANT_ID, false, [], []);
      const second = await fetchTracesFromClickHouse(
        ch,
        TENANT_ID,
        false,
        [],
        [],
        first.lastSort!,
      );

      expect(second.traces.length).toBeGreaterThan(0);
      const firstIds = new Set(first.traces.map((t) => t.trace_id));
      expect(second.traces.some((t) => firstIds.has(t.trace_id))).toBe(false);
    });
  });

  describe("when the newest traces have empty input", () => {
    // The page is selected by recency alone, so empty-input traces still
    // occupy page slots. The cursor must track the page boundary (including
    // those rows) so pagination doesn't stall before older eligible traces —
    // the regression CodeRabbit flagged when the empty filter lived in SQL.
    const EMPTY_TENANT = "topic-fetch-empty-test";

    beforeAll(async () => {
      const now = Date.now();
      const bigInput = JSON.stringify("x".repeat(64));
      const rows = Array.from({ length: 40 }, (_, i) => ({
        ProjectionId: `proj-${nanoid()}`,
        TenantId: EMPTY_TENANT,
        TraceId: `${EMPTY_TENANT}-trace-${String(i).padStart(4, "0")}`,
        Version: "v1",
        Attributes: {},
        OccurredAt: new Date(now - i * 60_000),
        CreatedAt: new Date(now),
        UpdatedAt: new Date(now - i),
        ComputedIOSchemaVersion: "",
        // The 20 newest traces have empty input; the older 20 carry input.
        ComputedInput: i < 20 ? "" : bigInput,
        ComputedOutput: "out",
        TimeToFirstTokenMs: 1,
        TimeToLastTokenMs: 1,
        TotalDurationMs: 1,
        TokensPerSecond: 1,
        SpanCount: 1,
        ContainsErrorStatus: 0,
        ContainsOKStatus: 1,
        ErrorMessage: null,
        Models: ["gpt-5-mini"],
        TotalCost: 0.01,
        TokensEstimated: false,
        TotalPromptTokenCount: 1,
        TotalCompletionTokenCount: 1,
        OutputFromRootSpan: 0,
        OutputSpanEndTimeMs: 0,
        BlockedByGuardrail: 0,
        TopicId: null,
        SubTopicId: null,
        HasAnnotation: null,
      }));
      await ch.insert({
        table: "trace_summaries",
        values: rows,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
      });
    }, 60_000);

    afterAll(async () => {
      await cleanupTestData(EMPTY_TENANT);
    });

    it("advances the cursor past empty-input traces to reach older ones", async () => {
      const res = await fetchTracesFromClickHouse(ch, EMPTY_TENANT, false, [], []);

      // Only the 20 input-bearing traces are clustered...
      expect(res.traces).toHaveLength(20);
      // ...but pagination accounts for the whole page (incl. the 20 empties),
      // so the cursor reaches the oldest trace and clustering won't stall.
      expect(res.returnedCount).toBe(40);
      expect(res.lastSort?.[1]).toBe(`${EMPTY_TENANT}-trace-0039`);
    });
  });

  describe("when comparing peak memory against the pre-fix shape", () => {
    it("reads the heavy column for the page only, not the whole window", async () => {
      const paged = await peakMemoryBytes(ch, PAGED_SQL);
      const preFix = await peakMemoryBytes(ch, PRE_FIX_SQL);

      // The paged read touches ComputedInput for <=2000 traces; the pre-fix
      // shape touches it for the entire deduped window. On this seed the gap
      // is large — assert at least a 2x reduction to stay robust to noise.
      expect(paged).toBeGreaterThan(0);
      expect(preFix).toBeGreaterThan(0);
      expect(paged * 2).toBeLessThan(preFix);
    });
  });
});
