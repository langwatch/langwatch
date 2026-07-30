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

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { boundedSubquery } from "../../filter-to-clickhouse/subqueries";
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

function makeTraceSummaryRow(
  i: number,
  overrides: Record<string, unknown> = {},
) {
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

async function insertSpanRow(opts: {
  tenantId: string;
  traceId: string;
  spanType: string;
  startTimeMs: number;
}) {
  await ch.insert({
    table: "stored_spans",
    values: [
      {
        ProjectionId: `proj-${nanoid()}`,
        TenantId: opts.tenantId,
        TraceId: opts.traceId,
        SpanId: `span-${nanoid()}`,
        ParentSpanId: null,
        ParentTraceId: null,
        ParentIsRemote: null,
        Sampled: 1,
        StartTime: new Date(opts.startTimeMs),
        EndTime: new Date(opts.startTimeMs + 100),
        DurationMs: 100,
        SpanName: "s",
        SpanKind: 1,
        ServiceName: "t",
        ResourceAttributes: {},
        SpanAttributes: { "langwatch.span.type": opts.spanType },
        StatusCode: 1,
        StatusMessage: "",
        EventCount: 0,
        LinkCount: 0,
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
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

  describe("when a trace carries fold-summed cache + reasoning token attributes", () => {
    it("surfaces the reserved cache/reasoning keys so the drawer header can show them", async () => {
      const cacheTenant = `test-cache-attrs-${nanoid()}`;
      await ch.insert({
        table: "trace_summaries",
        values: [
          makeTraceSummaryRow(0, {
            TenantId: cacheTenant,
            TraceId: "cache-trace",
            Attributes: {
              "langwatch.origin": "coding_agent",
              "langwatch.reserved.cache_read_tokens": "31680",
              "langwatch.reserved.cache_creation_tokens": "6",
              "langwatch.reserved.reasoning_tokens": "100",
            },
          }),
        ],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
      });

      const page = await repo.findAll({
        ...baseQuery(),
        tenantId: cacheTenant,
        timeRange: { from: base - 60_000, to: base + 60_000 },
      });

      const row = page.rows.find((r) => r.traceId === "cache-trace");
      expect(row).toBeDefined();
      expect(row?.attributes["langwatch.reserved.cache_read_tokens"]).toBe(
        "31680",
      );
      expect(row?.attributes["langwatch.reserved.cache_creation_tokens"]).toBe(
        "6",
      );
      expect(row?.attributes["langwatch.reserved.reasoning_tokens"]).toBe(
        "100",
      );
      // The pre-existing allow-listed keys still flow through.
      expect(row?.attributes["langwatch.origin"]).toBe("coding_agent");
    });
  });
});

describe("TraceListClickHouseRepository.findCount (integration)", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const fcTenant = `test-find-count-${nanoid()}`;
  // The live poll asks "how many new traces since `since`". `since` is recent
  // (1 min before `base`) while the dashboard window reaches 10 days back, so
  // the span-filter subquery would scan 10 days of `stored_spans` without the
  // since-pruning.
  const since = base - 60_000;

  // Span-level filter: traces that contain an `llm` span. This is the shape
  // that injects the bounded `stored_spans` subquery the fix prunes.
  const llmSpanFilter = {
    sql: boundedSubquery(
      "stored_spans",
      "StartTime",
      "SpanAttributes['langwatch.span.type'] = {spanType:String}",
    ),
    params: { spanType: "llm" },
  };

  const countParams = {
    tenantId: fcTenant,
    timeRange: { from: base - 10 * DAY, to: base + DAY },
    since,
  };

  beforeAll(async () => {
    // A: recent trace with an llm span at `base` — newer than `since`, matches.
    await insertRows([
      makeTraceSummaryRow(0, {
        TenantId: fcTenant,
        TraceId: "fc-recent",
        OccurredAt: new Date(base),
        UpdatedAt: new Date(base),
        LastEventOccurredAt: new Date(base),
      }),
    ]);
    await insertSpanRow({
      tenantId: fcTenant,
      traceId: "fc-recent",
      spanType: "llm",
      startTimeMs: base,
    });

    // B: old trace (5 days before `since`) with an llm span — excluded by the
    // OccurredAt > since predicate, must not be counted.
    await insertRows([
      makeTraceSummaryRow(0, {
        TenantId: fcTenant,
        TraceId: "fc-old",
        OccurredAt: new Date(base - 5 * DAY),
        UpdatedAt: new Date(base - 5 * DAY),
        LastEventOccurredAt: new Date(base - 5 * DAY),
      }),
    ]);
    await insertSpanRow({
      tenantId: fcTenant,
      traceId: "fc-old",
      spanType: "llm",
      startTimeMs: base - 5 * DAY,
    });

    // C: edge trace whose OccurredAt is just AFTER `since`, but whose matching
    // llm span STARTED ~30 min BEFORE `since` (inside the 2-day buffer). It must
    // still be counted. A naive tighten-exactly-to-`since` would drop it; this
    // guards the buffer.
    await insertRows([
      makeTraceSummaryRow(0, {
        TenantId: fcTenant,
        TraceId: "fc-edge",
        OccurredAt: new Date(since + 1000),
        UpdatedAt: new Date(since + 1000),
        LastEventOccurredAt: new Date(since + 1000),
      }),
    ]);
    await insertSpanRow({
      tenantId: fcTenant,
      traceId: "fc-edge",
      spanType: "llm",
      startTimeMs: since - 30 * 60 * 1000,
    });
  }, 120_000);

  afterAll(async () => {
    if (!ch) return;
    await ch.exec({
      query:
        "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId: fcTenant },
    });
    await ch.exec({
      query:
        "ALTER TABLE stored_spans DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId: fcTenant },
    });
  });

  it("counts only span-filtered traces newer than `since`", async () => {
    const count = await repo.findCount({
      ...countParams,
      filterWhere: llmSpanFilter,
    });
    // fc-recent + fc-edge; fc-old is excluded by OccurredAt > since.
    expect(count).toBe(2);
  });

  it("keeps a near-edge match whose span started just before `since`", async () => {
    // fc-edge's span StartTime is before `since` but inside the buffer; pruning
    // the stored_spans scan must not drop it.
    const count = await repo.findCount({
      ...countParams,
      filterWhere: llmSpanFilter,
    });
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("counts new traces since `since` without a span filter", async () => {
    const count = await repo.findCount(countParams);
    // fc-recent + fc-edge are newer than since; fc-old is not.
    expect(count).toBe(2);
  });
});
