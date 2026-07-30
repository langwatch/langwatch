import { describe, expect, it } from "vitest";
import { storedSpansTable } from "../table";
import {
  buildSpanRollupQuery,
  buildTraceTotalsQuery,
  deriveTraceTotals,
  querySpanRollup,
} from "../totals";
import { createFakeClient, readable, TRACE_ID } from "./fixtures";

const TOTALS_HEADER = {
  names: [
    "TraceId",
    "SpanCount",
    "RootSpanCount",
    "CostSum",
    "CostCount",
    "NonBilledCostSum",
    "NonBilledCostCount",
    "PromptTokens",
    "CompletionTokens",
    "CacheReadTokens",
    "CacheWriteTokens",
    "ReasoningTokens",
    "TokenReportCount",
    "EstimatedCount",
  ],
  types: [
    "String",
    "UInt64",
    "UInt64",
    "Float64",
    "UInt64",
    "Float64",
    "UInt64",
    "UInt64",
    "UInt64",
    "UInt64",
    "UInt64",
    "UInt64",
    "UInt64",
    "UInt64",
  ],
};

function totalsRow(values: {
  traceId?: string;
  spanCount?: number;
  rootSpanCount?: number;
  costSum?: number;
  costCount?: number;
  nonBilledCostSum?: number;
  nonBilledCostCount?: number;
  promptTokens?: number;
  completionTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  tokenReportCount?: number;
  estimatedCount?: number;
}): unknown[] {
  return [
    values.traceId ?? TRACE_ID,
    String(values.spanCount ?? 0),
    String(values.rootSpanCount ?? 0),
    values.costSum ?? 0,
    String(values.costCount ?? 0),
    values.nonBilledCostSum ?? 0,
    String(values.nonBilledCostCount ?? 0),
    String(values.promptTokens ?? 0),
    String(values.completionTokens ?? 0),
    String(values.cacheReadTokens ?? 0),
    String(values.cacheWriteTokens ?? 0),
    String(values.reasoningTokens ?? 0),
    String(values.tokenReportCount ?? 0),
    String(values.estimatedCount ?? 0),
  ];
}

describe("trace totals derived from stored spans", () => {
  describe("given the query this pipeline issues", () => {
    it("binds every table and column name rather than interpolating it", () => {
      const { sql } = buildTraceTotalsQuery({
        tenantId: "tenant-1",
        traceIds: [TRACE_ID],
      });

      expect(sql).not.toContain("stored_spans");
      expect(sql).not.toContain("TenantId ");
      expect(sql).toContain(":Identifier}");
    });

    it("dedups on the table's own engine key, so a redelivered span counts once", () => {
      const query = buildTraceTotalsQuery({
        tenantId: "tenant-1",
        traceIds: [TRACE_ID],
      });
      const sql = readable(query);
      const dedupKey = storedSpansTable.sortKey.join(", ");

      expect(sql).toContain(`GROUP BY ${dedupKey}`);
      expect(sql).toContain(`SELECT ${dedupKey}, max(WrittenAt)`);
    });

    it("bounds the dedup subquery by trace, not by the caller's time range", () => {
      const query = buildTraceTotalsQuery({
        tenantId: "tenant-1",
        traceIds: [TRACE_ID],
        acceptedAtRange: {
          from: new Date("2026-07-01T00:00:00.000Z"),
          to: new Date("2026-07-30T00:00:00.000Z"),
        },
      });
      const sql = readable(query);
      const subquery = sql.slice(sql.indexOf("IN ("));

      expect(sql).toContain("t.AcceptedAt >= {acceptedAtFrom:DateTime64(3)}");
      expect(subquery).not.toContain("acceptedAtFrom");
    });
  });

  describe("given a trace whose spans reported no cost at all", () => {
    it("reports no cost rather than a cost of zero", async () => {
      const client = createFakeClient({
        rows: [totalsRow({ spanCount: 3, rootSpanCount: 1 })],
        header: TOTALS_HEADER,
      });

      const [totals] = await deriveTraceTotals({
        client,
        tenantId: "tenant-1",
        traceIds: [TRACE_ID],
      });

      expect(totals?.totalCost).toBeNull();
      expect(totals?.hasTokenUsage).toBe(false);
      expect(totals?.spanCount).toBe(3);
    });

    it("reports a cost of zero once a span reported token usage", async () => {
      const client = createFakeClient({
        rows: [totalsRow({ spanCount: 2, tokenReportCount: 2 })],
        header: TOTALS_HEADER,
      });

      const [totals] = await deriveTraceTotals({
        client,
        tenantId: "tenant-1",
        traceIds: [TRACE_ID],
      });

      expect(totals?.totalCost).toBe(0);
      expect(totals?.hasTokenUsage).toBe(true);
    });
  });

  describe("given a trace priced across several spans", () => {
    it("rounds the sum once, at read time", async () => {
      const client = createFakeClient({
        rows: [
          totalsRow({
            spanCount: 4,
            costSum: 0.1 + 0.2 + 0.30000000004,
            costCount: 3,
            promptTokens: 30,
            completionTokens: 40,
            reasoningTokens: 5,
            tokenReportCount: 3,
            estimatedCount: 1,
          }),
        ],
        header: TOTALS_HEADER,
      });

      const [totals] = await deriveTraceTotals({
        client,
        tenantId: "tenant-1",
        traceIds: [TRACE_ID],
      });

      expect(totals?.totalCost).toBe(0.6);
      expect(totals?.promptTokens).toBe(30);
      expect(totals?.completionTokens).toBe(40);
      expect(totals?.reasoningTokens).toBe(5);
      expect(totals?.tokensEstimated).toBe(true);
    });
  });

  describe("given a trace past the processing threshold", () => {
    it("marks it oversized so per-span work downstream can back off", async () => {
      const client = createFakeClient({
        rows: [totalsRow({ spanCount: 20_000 })],
        header: TOTALS_HEADER,
      });

      const [totals] = await deriveTraceTotals({
        client,
        tenantId: "tenant-1",
        traceIds: [TRACE_ID],
      });

      expect(totals?.oversized).toBe(true);
    });
  });

  describe("given no trace ids at all", () => {
    it("answers without issuing a query", async () => {
      const client = createFakeClient();

      await expect(
        deriveTraceTotals({ client, tenantId: "tenant-1", traceIds: [] }),
      ).resolves.toEqual([]);
      expect(client.queryCalls).toHaveLength(0);
    });
  });
});

describe("the span rollup", () => {
  const acceptedAtRange = {
    from: new Date("2026-07-01T00:00:00.000Z"),
    to: new Date("2026-07-30T00:00:00.000Z"),
  };

  it("buckets by whole minutes with integer arithmetic, never a session timezone", () => {
    const sql = readable(
      buildSpanRollupQuery({ tenantId: "tenant-1", acceptedAtRange }),
    );

    expect(sql).toContain("intDiv(t.StartTimeUnixMs, 60000) * 60000");
    expect(sql).toContain("GROUP BY BucketStartMs, Model, SpanType");
  });

  it("bounds the dedup subquery by the same range, so it prunes partitions too", () => {
    const query = buildSpanRollupQuery({
      tenantId: "tenant-1",
      acceptedAtRange,
    });
    const sql = readable(query);
    const subquery = sql.slice(sql.indexOf("IN ("));

    expect(subquery).toContain("AcceptedAt >= {acceptedAtFrom:DateTime64(3)}");
  });

  it("reads each bucket's measures straight off the spans", async () => {
    const client = createFakeClient({
      rows: [
        [
          "60000",
          "gpt-5-mini",
          "llm",
          "10",
          "2",
          "1",
          1.5,
          0.25,
          "900",
          "100",
          "200",
          "0",
          "0",
          "10",
        ],
      ],
      header: {
        names: [
          "BucketStartMs",
          "Model",
          "SpanType",
          "SpanCount",
          "TraceCount",
          "ErrorCount",
          "CostSum",
          "NonBilledCostSum",
          "DurationSumMs",
          "PromptTokens",
          "CompletionTokens",
          "CacheReadTokens",
          "CacheWriteTokens",
          "ReasoningTokens",
        ],
        types: [
          "UInt64",
          "String",
          "String",
          "UInt64",
          "UInt64",
          "UInt64",
          "Float64",
          "Float64",
          "UInt64",
          "UInt64",
          "UInt64",
          "UInt64",
          "UInt64",
          "UInt64",
        ],
      },
    });

    const [bucket] = await querySpanRollup({
      client,
      tenantId: "tenant-1",
      acceptedAtRange,
    });

    expect(bucket).toEqual({
      bucketStartMs: 60_000,
      model: "gpt-5-mini",
      spanType: "llm",
      spanCount: 10,
      traceCount: 2,
      errorCount: 1,
      costSum: 1.5,
      nonBilledCostSum: 0.25,
      durationSumMs: 900,
      promptTokens: 100,
      completionTokens: 200,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 10,
    });
  });
});
