/**
 * Regression tests for per-model analytics attribution, against real ClickHouse.
 *
 * Bug 1: `groupBy metadata.model` used to attribute each trace's FULL totals
 * (cost, tokens) to EVERY model bucket the trace touched, so a multi-model
 * trace multiplied its cost by the number of models it used (about 2.9x in a
 * real multi-agent session). Per-model buckets must PARTITION the truth:
 * the sum over all buckets equals the ungrouped total, exactly.
 *
 * Bug 2: `performance.total_tokens` (and other composite metrics) under a
 * grouped (CTE/dedup) query collapsed to the FIRST matched column, so
 * total_tokens returned prompt_tokens only. Regression fixtures make prompt
 * and completion differ so the bug cannot hide.
 *
 * Bug 3 (query side): traces that DO have span-level models must not mint a
 * spurious `unknown` bucket, while genuinely model-less traces still land in
 * `unknown` (that case is honest).
 *
 * Fixture data lives in test-utils/model-attribution-fixtures.ts.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { wrapWithDefaultSettings } from "~/server/clickhouse/safeClickhouseClient";
import {
  cleanupTestData,
  getTestClickHouseClient,
} from "../../../event-sourcing/__tests__/integration/testContainers";
import type { SeriesInputType } from "../../registry";
import { buildTimeseriesQuery } from "../aggregation-builder";
import { resetParamCounter } from "../filter-translator";
import {
  ALL_SPANS,
  ALL_TRACES,
  deleteTenantRowsSync,
  EXPECTED_COMPLETION_TOKENS,
  EXPECTED_NON_BILLED_COST,
  EXPECTED_PROMPT_TOKENS,
  EXPECTED_TOTAL_COST,
  EXPECTED_TOTAL_TOKENS,
  MODEL_CAP_A,
  MODEL_CAP_B,
  MODEL_ENV_A,
  MODEL_ENV_B,
  MODEL_HAIKU,
  MODEL_OPUS,
  MODEL_OPUS_1M,
  MODEL_SONNET,
  storedSpanRow,
  T0,
  traceSummaryRow,
} from "./test-utils/model-attribution-fixtures";

const TENANT_ID = "model-group-attribution-test";

const baseInput = {
  projectId: TENANT_ID,
  startDate: new Date(T0 - 23 * 60 * 60 * 1000),
  endDate: new Date(T0 + 60 * 60 * 1000),
  previousPeriodStartDate: new Date(T0 - 47 * 60 * 60 * 1000),
  timeScale: "full" as const,
};

interface ResultRow {
  period: string;
  group_key?: string;
  [alias: string]: unknown;
}

async function runQuery(
  ch: ClickHouseClient,
  series: SeriesInputType[],
  groupBy?: string,
  filters?: Parameters<typeof buildTimeseriesQuery>[0]["filters"],
): Promise<ResultRow[]> {
  resetParamCounter();
  const { sql, params } = buildTimeseriesQuery({
    ...baseInput,
    series,
    ...(groupBy ? { groupBy } : {}),
    ...(filters ? { filters } : {}),
  });
  const result = await ch.query({
    query: sql,
    query_params: params,
    format: "JSONEachRow",
  });
  return (await result.json()) as ResultRow[];
}

/** Collect { group_key: numeric value } for the current period. */
function bucketsOf(rows: ResultRow[], alias: string): Record<string, number> {
  const buckets: Record<string, number> = {};
  for (const row of rows) {
    if (row.period !== "current") continue;
    buckets[row.group_key ?? ""] = Number(row[alias]);
  }
  return buckets;
}

function currentValue(rows: ResultRow[], alias: string): number {
  const row = rows.find((r) => r.period === "current");
  return row ? Number(row[alias]) : Number.NaN;
}

function bucketSum(buckets: Record<string, number>): number {
  return Object.values(buckets).reduce((a, b) => a + b, 0);
}

const sumSeries = (metric: SeriesInputType["metric"]): SeriesInputType[] => [
  { metric, aggregation: "sum" },
];

describe("model group attribution (integration)", () => {
  let ch: ClickHouseClient;

  beforeAll(async () => {
    const rawClient = getTestClickHouseClient();
    if (!rawClient) throw new Error("ClickHouse client not available");
    ch = wrapWithDefaultSettings(rawClient);

    // Pre-clean: an aborted previous run leaves its rows behind (afterAll
    // never ran), and a second fixture copy passes the count-at-least guard
    // below while failing every partition assertion at exactly 2x.
    await deleteTenantRowsSync({ client: ch, tenantId: TENANT_ID });

    await ch.insert({
      table: "trace_summaries",
      values: ALL_TRACES.map((t) => traceSummaryRow(TENANT_ID, t)),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
    await ch.insert({
      table: "stored_spans",
      values: ALL_SPANS.map((s) => storedSpanRow(TENANT_ID, s)),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });

    // Read-back guard: fail HERE with a clear message if the fixture rows are
    // not visible, so an environment problem can never masquerade as an
    // aggregation bug in the assertions below.
    for (const [table, expected] of [
      ["trace_summaries", ALL_TRACES.length],
      ["stored_spans", ALL_SPANS.length],
    ] as const) {
      const res = await ch.query({
        query: `SELECT count() AS c FROM ${table} WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId: TENANT_ID },
        format: "JSONEachRow",
      });
      const [row] = (await res.json()) as Array<{ c: string }>;
      if (Number(row?.c ?? 0) < expected) {
        throw new Error(
          `Fixture read-back failed: ${table} has ${row?.c ?? 0} rows for ${TENANT_ID}, expected at least ${expected}`,
        );
      }
    }
  }, 60_000);

  afterAll(async () => {
    await cleanupTestData(TENANT_ID);
  });

  describe("when querying ungrouped totals (the partition target)", () => {
    it("computes the exact ungrouped totals from trace summaries", async () => {
      const cost = await runQuery(ch, sumSeries("performance.total_cost"));
      expect(currentValue(cost, "0__performance_total_cost__sum")).toBeCloseTo(
        EXPECTED_TOTAL_COST,
        9,
      );

      const totalTokens = await runQuery(
        ch,
        sumSeries("performance.total_tokens"),
      );
      expect(
        currentValue(totalTokens, "0__performance_total_tokens__sum"),
      ).toBe(EXPECTED_TOTAL_TOKENS);
    });
  });

  describe("when grouping by metadata.model", () => {
    it("attributes cost per span-level model; buckets sum to the exact ungrouped total", async () => {
      const rows = await runQuery(
        ch,
        sumSeries("performance.total_cost"),
        "metadata.model",
      );
      const buckets = bucketsOf(rows, "0__performance_total_cost__sum");

      expect(buckets[MODEL_OPUS]).toBeCloseTo(0.5, 9);
      // Multi-model trace A + legacy-bundled trace E share the sonnet bucket.
      expect(buckets[MODEL_SONNET]).toBeCloseTo(0.25 + 0.25, 9);
      // The [1m]-suffixed model is its own bucket.
      expect(buckets[MODEL_OPUS_1M]).toBeCloseTo(0.125, 9);
      // Single-model trace + skip-gated trace share the haiku bucket; the
      // redundant-usage copy span must NOT double the bucket.
      expect(buckets[MODEL_HAIKU]).toBeCloseTo(0.0625 + 0.03125, 9);

      expect(bucketSum(buckets)).toBeCloseTo(EXPECTED_TOTAL_COST, 9);
    });

    it("partitions prompt, completion, and total tokens across model buckets", async () => {
      const prompt = bucketsOf(
        await runQuery(
          ch,
          sumSeries("performance.prompt_tokens"),
          "metadata.model",
        ),
        "0__performance_prompt_tokens__sum",
      );
      expect(prompt[MODEL_OPUS]).toBe(1000);
      expect(prompt[MODEL_SONNET]).toBe(2000);
      expect(prompt[MODEL_OPUS_1M]).toBe(4000);
      expect(prompt[MODEL_HAIKU]).toBe(800 + 100);
      expect(bucketSum(prompt)).toBe(EXPECTED_PROMPT_TOKENS);

      const completion = bucketsOf(
        await runQuery(
          ch,
          sumSeries("performance.completion_tokens"),
          "metadata.model",
        ),
        "0__performance_completion_tokens__sum",
      );
      expect(completion[MODEL_OPUS]).toBe(100);
      expect(completion[MODEL_SONNET]).toBe(200);
      expect(completion[MODEL_OPUS_1M]).toBe(400);
      expect(completion[MODEL_HAIKU]).toBe(80 + 10);
      expect(bucketSum(completion)).toBe(EXPECTED_COMPLETION_TOKENS);

      // total_tokens crosses bug 2 (composite metric) with bug 1 (grouping):
      // prompt and completion differ per bucket so neither bug can hide.
      const total = bucketsOf(
        await runQuery(
          ch,
          sumSeries("performance.total_tokens"),
          "metadata.model",
        ),
        "0__performance_total_tokens__sum",
      );
      expect(total[MODEL_OPUS]).toBe(1100);
      expect(total[MODEL_SONNET]).toBe(2200);
      expect(total[MODEL_OPUS_1M]).toBe(4400);
      expect(total[MODEL_HAIKU]).toBe(880 + 110);
      expect(bucketSum(total)).toBe(EXPECTED_TOTAL_TOKENS);
    });

    it("partitions the billed/non-billed cost split across model buckets", async () => {
      const nonBilled = bucketsOf(
        await runQuery(
          ch,
          sumSeries("performance.cost_non_billed"),
          "metadata.model",
        ),
        "0__performance_cost_non_billed__sum",
      );
      // Trace A: fold-time per-span split on the [1m] span.
      expect(nonBilled[MODEL_OPUS_1M]).toBeCloseTo(0.125, 9);
      // Trace E: the legacy all-or-nothing marker classifies its whole cost
      // as bundled, so its sonnet bucket share is fully non-billed.
      expect(nonBilled[MODEL_SONNET]).toBeCloseTo(0.25, 9);
      expect(nonBilled[MODEL_OPUS] ?? 0).toBeCloseTo(0, 9);
      expect(bucketSum(nonBilled)).toBeCloseTo(EXPECTED_NON_BILLED_COST, 9);

      const billed = bucketsOf(
        await runQuery(
          ch,
          sumSeries("performance.cost_billed"),
          "metadata.model",
        ),
        "0__performance_cost_billed__sum",
      );
      expect(billed[MODEL_OPUS]).toBeCloseTo(0.5, 9);
      // Trace A's sonnet span is billed; trace E's sonnet share is not.
      expect(billed[MODEL_SONNET]).toBeCloseTo(0.25, 9);
      expect(billed[MODEL_OPUS_1M]).toBeCloseTo(0, 9);
      expect(bucketSum(billed)).toBeCloseTo(
        EXPECTED_TOTAL_COST - EXPECTED_NON_BILLED_COST,
        9,
      );
    });

    it("partitions cache and processed tokens across model buckets", async () => {
      const processed = bucketsOf(
        await runQuery(
          ch,
          sumSeries("performance.total_processed_tokens"),
          "metadata.model",
        ),
        "0__performance_total_processed_tokens__sum",
      );
      // opus carries the trace's cache traffic: 1000+100+10000+500
      expect(processed[MODEL_OPUS]).toBe(11600);
      expect(processed[MODEL_SONNET]).toBe(2200);
      expect(processed[MODEL_OPUS_1M]).toBe(4400);
      expect(processed[MODEL_HAIKU]).toBe(880 + 110);
      const expectedProcessed = EXPECTED_TOTAL_TOKENS + 10000 + 500;
      expect(bucketSum(processed)).toBe(expectedProcessed);
    });

    it("counts traces per model without a spurious unknown bucket", async () => {
      const rows = await runQuery(
        ch,
        [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
        "metadata.model",
      );
      const buckets = bucketsOf(rows, "0__metadata_trace_id__cardinality");

      expect(buckets[MODEL_OPUS]).toBe(1);
      expect(buckets[MODEL_SONNET]).toBe(2);
      expect(buckets[MODEL_OPUS_1M]).toBe(1);
      expect(buckets[MODEL_HAIKU]).toBe(2);
      // Only the genuinely model-less trace lands in `unknown`. The other
      // traces all have model-less root spans with zero contribution and must
      // NOT mint an unknown bucket.
      expect(buckets.unknown).toBe(1);
    });

    it("keeps traces past the fold cap on whole-trace attribution", async () => {
      // The fold froze this trace's totals at MAX_PROCESSED_SPANS while
      // stored_spans holds one more span on another model. Span-level sums
      // would EXCEED the frozen ungrouped total, so the whole trace must sit
      // under its primary model instead.
      const rows = await runQuery(
        ch,
        sumSeries("performance.total_cost"),
        "metadata.model",
      );
      const buckets = bucketsOf(rows, "0__performance_total_cost__sum");
      expect(buckets[MODEL_CAP_A]).toBeCloseTo(0.512, 9);
      expect(buckets[MODEL_CAP_B]).toBeUndefined();
    });

    it("falls back to the primary model when spans fall outside the scan envelope", async () => {
      // One contributing span sits outside the StartTime scan cushion. A
      // partial span scan must NOT ship a partial partition (model A's share
      // only); the whole trace falls back to its primary model.
      const rows = await runQuery(
        ch,
        sumSeries("performance.total_cost"),
        "metadata.model",
      );
      const buckets = bucketsOf(rows, "0__performance_total_cost__sum");
      expect(buckets[MODEL_ENV_B]).toBeCloseTo(0.09375, 9);
      expect(buckets[MODEL_ENV_A]).toBeUndefined();
    });
  });

  describe("when grouping by metadata.model with a span-joined filter", () => {
    // The generic stored_spans filter JOIN (alias ss) and the span-model
    // partition JOIN (alias smd) must coexist in one query without breaking
    // the partition property.
    it("keeps exact bucket partition when filtering by span type", async () => {
      const rows = await runQuery(
        ch,
        sumSeries("performance.total_cost"),
        "metadata.model",
        { "spans.type": ["llm"] },
      );
      const buckets = bucketsOf(rows, "0__performance_total_cost__sum");

      // Every fixture trace has at least one llm span except the model-less
      // one, so the filtered result keeps the same partition.
      expect(buckets[MODEL_OPUS]).toBeCloseTo(0.5, 9);
      expect(buckets[MODEL_SONNET]).toBeCloseTo(0.5, 9);
      expect(buckets[MODEL_OPUS_1M]).toBeCloseTo(0.125, 9);
      expect(buckets[MODEL_HAIKU]).toBeCloseTo(0.0625 + 0.03125, 9);
      expect(bucketSum(buckets)).toBeCloseTo(EXPECTED_TOTAL_COST, 9);
    });
  });

  // metadata.labels grouping exercises the same CTE/dedup path with
  // whole-trace attribution, isolating bug 2 from bug 1's model fix.
  describe("when grouping by metadata.labels (composite metrics on the dedup path)", () => {
    it("total_tokens = prompt + completion", async () => {
      const rows = await runQuery(
        ch,
        sumSeries("performance.total_tokens"),
        "metadata.labels",
      );
      const buckets = bucketsOf(rows, "0__performance_total_tokens__sum");
      expect(buckets["session-x"]).toBe(7700);
    });

    it("cost_billed subtracts the non-billed portion", async () => {
      const rows = await runQuery(
        ch,
        sumSeries("performance.cost_billed"),
        "metadata.labels",
      );
      const buckets = bucketsOf(rows, "0__performance_cost_billed__sum");
      expect(buckets["session-x"]).toBeCloseTo(0.875 - 0.125, 9);
    });

    it("cost_non_billed reads the non-billed column", async () => {
      const rows = await runQuery(
        ch,
        sumSeries("performance.cost_non_billed"),
        "metadata.labels",
      );
      const buckets = bucketsOf(rows, "0__performance_cost_non_billed__sum");
      expect(buckets["session-x"]).toBeCloseTo(0.125, 9);
    });

    it("total_processed_tokens includes cache traffic", async () => {
      const rows = await runQuery(
        ch,
        sumSeries("performance.total_processed_tokens"),
        "metadata.labels",
      );
      const buckets = bucketsOf(
        rows,
        "0__performance_total_processed_tokens__sum",
      );
      expect(buckets["session-x"]).toBe(7700 + 10000 + 500);
    });

    it("cache token metrics work", async () => {
      const read = bucketsOf(
        await runQuery(
          ch,
          sumSeries("performance.cache_read_tokens"),
          "metadata.labels",
        ),
        "0__performance_cache_read_tokens__sum",
      );
      expect(read["session-x"]).toBe(10000);

      const write = bucketsOf(
        await runQuery(
          ch,
          sumSeries("performance.cache_write_tokens"),
          "metadata.labels",
        ),
        "0__performance_cache_write_tokens__sum",
      );
      expect(write["session-x"]).toBe(500);
    });
  });
});
