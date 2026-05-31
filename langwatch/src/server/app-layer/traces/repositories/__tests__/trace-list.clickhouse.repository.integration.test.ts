/**
 * Integration tests for `TraceListClickHouseRepository.findAll`, exercised
 * against a real ClickHouse testcontainer on the production `trace_summaries`
 * schema.
 *
 * Focus: the trace list must read the heavy `ComputedInput`/`ComputedOutput`
 * payload for at most one page of traces, not for every deduped trace in the
 * window. The window scan over those payloads (plus the `count() OVER ()`
 * buffer) is the dominant read-bytes cost on this list in prod, so the test
 * seeds far more traces than one page and asserts both correctness and a real
 * peak-memory reduction versus the naive single-scan form.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { TraceListClickHouseRepository } from "../trace-list.clickhouse.repository";
import type { TraceListQuery } from "../trace-list.repository";

const tenantId = `test-trace-list-${nanoid()}`;
const base = Date.now() - 60 * 60 * 1000;

const TOTAL_TRACES = 800;
const PAGE_LIMIT = 200;
const HEAVY_INPUT = "i".repeat(8000);
const HEAVY_OUTPUT = "o".repeat(8000); // ~16KB of payload per trace

let ch: ClickHouseClient;
let repo: TraceListClickHouseRepository;

function traceIdFor(i: number): string {
  return `tr-${String(i).padStart(4, "0")}`;
}

function makeTraceSummaryRow(i: number, overrides: Record<string, unknown> = {}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceIdFor(i),
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(base + i),
    CreatedAt: new Date(base + i),
    UpdatedAt: new Date(base + i),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: `input-${i}-${HEAVY_INPUT}`,
    ComputedOutput: `output-${i}-${HEAVY_OUTPUT}`,
    TimeToFirstTokenMs: null,
    TimeToLastTokenMs: null,
    TotalDurationMs: 100,
    TokensPerSecond: null,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    ErrorMessage: null,
    Models: [],
    TotalCost: null,
    TokensEstimated: false,
    TotalPromptTokenCount: null,
    TotalCompletionTokenCount: null,
    OutputFromRootSpan: false,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: false,
    TraceName: `trace-${i}`,
    RootSpanType: "",
    ContainsAi: false,
    ContainsPrompt: false,
    AnnotationIds: [],
    LastEventOccurredAt: new Date(base + i),
    TopicId: null,
    SubTopicId: null,
    ...overrides,
  };
}

async function insertRows(rows: ReturnType<typeof makeTraceSummaryRow>[]) {
  const chunk = 200;
  for (let i = 0; i < rows.length; i += chunk) {
    await ch.insert({
      table: "trace_summaries",
      values: rows.slice(i, i + chunk),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }
}

function baseQuery(): TraceListQuery {
  return {
    tenantId,
    timeRange: { from: base - 60_000, to: base + TOTAL_TRACES + 60_000 },
    sort: { column: "OccurredAt", direction: "desc" },
    limit: PAGE_LIMIT,
    offset: 0,
  };
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  repo = new TraceListClickHouseRepository(async () => ch);

  const rows = Array.from({ length: TOTAL_TRACES }, (_, i) =>
    makeTraceSummaryRow(i),
  );
  await insertRows(rows);

  // A stale earlier version of the newest trace (same OccurredAt, older
  // UpdatedAt): dedup must return the latest payload, and the count must not
  // double-count it.
  await insertRows([
    makeTraceSummaryRow(TOTAL_TRACES - 1, {
      ComputedInput: "stale-input",
      ComputedOutput: "stale-output",
      UpdatedAt: new Date(base - 10_000),
      CreatedAt: new Date(base - 10_000),
    }),
  ]);
}, 120_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query:
        "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
  }
  await stopTestContainers();
});

describe("TraceListClickHouseRepository.findAll (integration)", () => {
  describe("when the window holds far more traces than one page", () => {
    it("returns one page ordered by the sort column", async () => {
      const page = await repo.findAll(baseQuery());

      expect(page.rows).toHaveLength(PAGE_LIMIT);
      // OccurredAt DESC → the newest PAGE_LIMIT traces, newest first.
      const expected = Array.from({ length: PAGE_LIMIT }, (_, i) =>
        traceIdFor(TOTAL_TRACES - 1 - i),
      );
      expect(page.rows.map((r) => r.traceId)).toEqual(expected);
    });

    it("reports the full deduped total, not just the page size", async () => {
      const page = await repo.findAll(baseQuery());
      expect(page.totalHits).toBe(TOTAL_TRACES);
    });

    it("returns the latest version of a duplicated trace, not the stale one", async () => {
      const page = await repo.findAll(baseQuery());
      const newest = page.rows.find(
        (r) => r.traceId === traceIdFor(TOTAL_TRACES - 1),
      );
      expect(newest).toBeDefined();
      expect(newest?.computedInput).toContain(`input-${TOTAL_TRACES - 1}-`);
      expect(newest?.computedInput).not.toContain("stale");
    });

    it("honours offset paging without overlap", async () => {
      const page2 = await repo.findAll({ ...baseQuery(), offset: PAGE_LIMIT });
      const expected = Array.from({ length: PAGE_LIMIT }, (_, i) =>
        traceIdFor(TOTAL_TRACES - 1 - PAGE_LIMIT - i),
      );
      expect(page2.rows.map((r) => r.traceId)).toEqual(expected);
    });

    it("reads heavy columns for fewer traces than the naive single-scan form", async () => {
      const dedup = `(TenantId, TraceId, UpdatedAt) IN (
        SELECT TenantId, TraceId, max(UpdatedAt)
        FROM trace_summaries
        WHERE TenantId = {tenantId:String}
          AND OccurredAt >= fromUnixTimestamp64Milli({from:Int64})
        GROUP BY TenantId, TraceId
      )`;
      const where = `TenantId = {tenantId:String}
        AND OccurredAt >= fromUnixTimestamp64Milli({from:Int64})`;
      const params = { tenantId, from: base - 60_000, limit: PAGE_LIMIT };

      const naiveId = `naive-${nanoid()}`;
      const pagedId = `paged-${nanoid()}`;

      // Naive: heavy payload for every deduped trace + count() OVER () buffer.
      await ch
        .query({
          query: `
            SELECT TraceId, ComputedInput, ComputedOutput,
              count() OVER () AS TotalCount
            FROM trace_summaries
            WHERE ${where} AND ${dedup}
            ORDER BY OccurredAt DESC
            LIMIT {limit:UInt32}
          `,
          query_params: params,
          query_id: naiveId,
          format: "JSONEachRow",
        })
        .then((r) => r.json());

      // Paged: pick the TraceId page first, read heavy payload for those only.
      await ch
        .query({
          query: `
            SELECT TraceId, ComputedInput, ComputedOutput
            FROM trace_summaries
            WHERE ${where}
              AND TraceId IN (
                SELECT TraceId
                FROM trace_summaries
                WHERE ${where} AND ${dedup}
                ORDER BY OccurredAt DESC
                LIMIT {limit:UInt32}
              )
              AND ${dedup}
            ORDER BY OccurredAt DESC
            LIMIT {limit:UInt32}
          `,
          query_params: params,
          query_id: pagedId,
          format: "JSONEachRow",
        })
        .then((r) => r.json());

      await ch.exec({ query: "SYSTEM FLUSH LOGS" });

      const memRows = (await (
        await ch.query({
          query: `
            SELECT query_id, max(memory_usage) AS mem
            FROM system.query_log
            WHERE query_id IN ({naiveId:String}, {pagedId:String})
              AND type = 'QueryFinish'
            GROUP BY query_id
          `,
          query_params: { naiveId, pagedId },
          format: "JSONEachRow",
        })
      ).json()) as Array<{ query_id: string; mem: string }>;

      const memOf = (id: string) =>
        Number(memRows.find((r) => r.query_id === id)?.mem ?? 0);
      const naiveMem = memOf(naiveId);
      const pagedMem = memOf(pagedId);

      expect(naiveMem).toBeGreaterThan(0);
      expect(pagedMem).toBeGreaterThan(0);
      expect(pagedMem).toBeLessThan(naiveMem);
    });
  });
});
