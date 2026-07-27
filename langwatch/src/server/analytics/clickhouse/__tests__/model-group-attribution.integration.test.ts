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
 * Fixtures mirror the fold's invariants: trace_summaries totals equal the sum
 * of the trace's span-level contributions (same SpanCostService semantics,
 * including the skip_token_accumulation gate), so the partition assertions
 * check the SQL attribution, not fixture arithmetic. All costs are exact at
 * 6 decimal places so per-span rounding is a no-op.
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

const TENANT_ID = "model-group-attribution-test";

/**
 * Fixture instant: one hour ago, like every other ClickHouse integration
 * fixture in this repo. Keep it now-relative: a fixed months-old date made
 * the rows invisible to the very same queries on CI's ClickHouse stack
 * (25.10.x + the local_primary storage policy) while passing against a local
 * 25.8 server, and the attribution semantics under test do not depend on
 * when the traces happened.
 */
const T0 = Date.now() - 60 * 60 * 1000;

const MODEL_OPUS = "claude-opus-5";
const MODEL_SONNET = "claude-sonnet-4-5";
/** The [1m] context-window suffix survives ingestion and must stay its own bucket. */
const MODEL_OPUS_1M = "claude-opus-5[1m]";
const MODEL_HAIKU = "claude-haiku-4-5";

interface SpanFixture {
  traceId: string;
  spanId: string;
  parentSpanId?: string | null;
  model?: string;
  cost?: number;
  nonBilledCost?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  skipTokenAccumulation?: boolean;
}

interface TraceFixture {
  traceId: string;
  models: string[];
  totalCost: number | null;
  nonBilledCost?: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  labels?: string[];
}

/**
 * Trace A: one multi-model trace (agent root + three LLM spans on distinct
 * models with distinct costs, one of them [1m]-suffixed). Trace totals are
 * the exact sum of the span contributions, as the fold guarantees.
 */
const TRACE_MULTI: TraceFixture = {
  traceId: "trace-multi",
  models: [MODEL_OPUS_1M, MODEL_SONNET, MODEL_OPUS],
  totalCost: 0.875,
  nonBilledCost: 0.125,
  promptTokens: 7000,
  completionTokens: 700,
  cacheReadTokens: 10000,
  cacheWriteTokens: 500,
  reasoningTokens: 50,
  labels: ["session-x"],
};

const TRACE_MULTI_SPANS: SpanFixture[] = [
  { traceId: "trace-multi", spanId: "a-root", parentSpanId: null },
  {
    traceId: "trace-multi",
    spanId: "a-opus",
    parentSpanId: "a-root",
    model: MODEL_OPUS,
    cost: 0.5,
    inputTokens: 1000,
    outputTokens: 100,
    cacheReadTokens: 10000,
    cacheWriteTokens: 500,
    reasoningTokens: 50,
  },
  {
    traceId: "trace-multi",
    spanId: "a-sonnet",
    parentSpanId: "a-root",
    model: MODEL_SONNET,
    cost: 0.25,
    inputTokens: 2000,
    outputTokens: 200,
  },
  {
    traceId: "trace-multi",
    spanId: "a-opus1m",
    parentSpanId: "a-root",
    model: MODEL_OPUS_1M,
    cost: 0.125,
    nonBilledCost: 0.125,
    inputTokens: 4000,
    outputTokens: 400,
  },
];

/** Trace B: single-model trace. */
const TRACE_SINGLE: TraceFixture = {
  traceId: "trace-single",
  models: [MODEL_HAIKU],
  totalCost: 0.0625,
  promptTokens: 800,
  completionTokens: 80,
};

const TRACE_SINGLE_SPANS: SpanFixture[] = [
  { traceId: "trace-single", spanId: "b-root", parentSpanId: null },
  {
    traceId: "trace-single",
    spanId: "b-haiku",
    parentSpanId: "b-root",
    model: MODEL_HAIKU,
    cost: 0.0625,
    inputTokens: 800,
    outputTokens: 80,
  },
];

/** Trace C: genuinely model-less trace; must bucket as `unknown` honestly. */
const TRACE_MODELLESS: TraceFixture = {
  traceId: "trace-modelless",
  models: [],
  totalCost: null,
  promptTokens: null,
  completionTokens: null,
};

const TRACE_MODELLESS_SPANS: SpanFixture[] = [
  { traceId: "trace-modelless", spanId: "c-root", parentSpanId: null },
];

/**
 * Trace D: a span pair where the second span is a redundant usage copy
 * (skip_token_accumulation). The fold counts the usage once, so the grouped
 * query must apply the same gate or the bucket overshoots the trace total.
 */
const TRACE_SKIP: TraceFixture = {
  traceId: "trace-skip",
  models: [MODEL_HAIKU],
  totalCost: 0.03125,
  promptTokens: 100,
  completionTokens: 10,
};

const TRACE_SKIP_SPANS: SpanFixture[] = [
  { traceId: "trace-skip", spanId: "d-root", parentSpanId: null },
  {
    traceId: "trace-skip",
    spanId: "d-haiku",
    parentSpanId: "d-root",
    model: MODEL_HAIKU,
    cost: 0.03125,
    inputTokens: 100,
    outputTokens: 10,
  },
  {
    traceId: "trace-skip",
    spanId: "d-haiku-copy",
    parentSpanId: "d-root",
    model: MODEL_HAIKU,
    cost: 0.03125,
    inputTokens: 100,
    outputTokens: 10,
    skipTokenAccumulation: true,
  },
];

const ALL_TRACES = [TRACE_MULTI, TRACE_SINGLE, TRACE_MODELLESS, TRACE_SKIP];
const ALL_SPANS = [
  ...TRACE_MULTI_SPANS,
  ...TRACE_SINGLE_SPANS,
  ...TRACE_MODELLESS_SPANS,
  ...TRACE_SKIP_SPANS,
];

/** Ungrouped truths the grouped buckets must partition to. */
const EXPECTED_TOTAL_COST = 0.875 + 0.0625 + 0.03125; // 0.96875
const EXPECTED_PROMPT_TOKENS = 7000 + 800 + 100; // 7900
const EXPECTED_COMPLETION_TOKENS = 700 + 80 + 10; // 790
const EXPECTED_TOTAL_TOKENS = EXPECTED_PROMPT_TOKENS + EXPECTED_COMPLETION_TOKENS; // 8690

function traceSummaryRow(t: TraceFixture) {
  const attributes: Record<string, string> = { "metadata.env": "test" };
  if (t.cacheReadTokens) {
    attributes["langwatch.reserved.cache_read_tokens"] = String(
      t.cacheReadTokens,
    );
  }
  if (t.cacheWriteTokens) {
    attributes["langwatch.reserved.cache_creation_tokens"] = String(
      t.cacheWriteTokens,
    );
  }
  if (t.reasoningTokens) {
    attributes["langwatch.reserved.reasoning_tokens"] = String(
      t.reasoningTokens,
    );
  }
  if (t.labels) {
    attributes["langwatch.labels"] = JSON.stringify(t.labels);
  }
  return {
    ProjectionId: `proj-${t.traceId}`,
    TenantId: TENANT_ID,
    TraceId: t.traceId,
    Version: "v1",
    Attributes: attributes,
    OccurredAt: new Date(T0),
    CreatedAt: new Date(T0),
    UpdatedAt: new Date(T0),
    ComputedIOSchemaVersion: "",
    ComputedInput: "in",
    ComputedOutput: "out",
    TimeToFirstTokenMs: 50,
    TimeToLastTokenMs: 200,
    TotalDurationMs: 200,
    TokensPerSecond: 100,
    SpanCount: ALL_SPANS.filter((s) => s.traceId === t.traceId).length,
    ContainsErrorStatus: 0,
    ContainsOKStatus: 1,
    ErrorMessage: null,
    Models: t.models,
    TotalCost: t.totalCost,
    NonBilledCost: t.nonBilledCost ?? null,
    TokensEstimated: false,
    TotalPromptTokenCount: t.promptTokens,
    TotalCompletionTokenCount: t.completionTokens,
    OutputFromRootSpan: 0,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: 0,
    TopicId: null,
    SubTopicId: null,
    HasAnnotation: null,
  };
}

function storedSpanRow(s: SpanFixture) {
  const attrs: Record<string, string> = {};
  if (s.model) {
    attrs["gen_ai.request.model"] = s.model;
    attrs["gen_ai.response.model"] = s.model;
    attrs["langwatch.span.type"] = "llm";
  } else {
    attrs["langwatch.span.type"] = "agent";
  }
  if (s.inputTokens !== undefined) {
    attrs["gen_ai.usage.input_tokens"] = String(s.inputTokens);
  }
  if (s.outputTokens !== undefined) {
    attrs["gen_ai.usage.output_tokens"] = String(s.outputTokens);
  }
  if (s.cacheReadTokens !== undefined) {
    attrs["gen_ai.usage.cache_read.input_tokens"] = String(s.cacheReadTokens);
  }
  if (s.cacheWriteTokens !== undefined) {
    attrs["gen_ai.usage.cache_creation.input_tokens"] = String(
      s.cacheWriteTokens,
    );
  }
  if (s.reasoningTokens !== undefined) {
    attrs["gen_ai.usage.reasoning_tokens"] = String(s.reasoningTokens);
  }
  if (s.skipTokenAccumulation) {
    attrs["langwatch.reserved.skip_token_accumulation"] = "true";
  }
  return {
    ProjectionId: `proj-${s.spanId}`,
    TenantId: TENANT_ID,
    TraceId: s.traceId,
    SpanId: s.spanId,
    ParentSpanId: s.parentSpanId ?? null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: new Date(T0),
    EndTime: new Date(T0 + 200),
    DurationMs: 200,
    SpanName: s.spanId,
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: attrs,
    StatusCode: 1,
    StatusMessage: "",
    ScopeName: "",
    ScopeVersion: null,
    "Events.Timestamp": [],
    "Events.Name": [],
    "Events.Attributes": [],
    "Links.TraceId": [],
    "Links.SpanId": [],
    "Links.Attributes": [],
    DroppedAttributesCount: 0,
    DroppedEventsCount: 0,
    DroppedLinksCount: 0,
    Cost: s.cost ?? null,
    NonBilledCost: s.nonBilledCost ?? null,
  };
}

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
): Promise<ResultRow[]> {
  resetParamCounter();
  const { sql, params } = buildTimeseriesQuery({
    ...baseInput,
    series,
    ...(groupBy ? { groupBy } : {}),
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

const sumSeries = (
  metric: SeriesInputType["metric"],
): SeriesInputType[] => [{ metric, aggregation: "sum" }];

describe("model group attribution (integration)", () => {
  let ch: ClickHouseClient;

  beforeAll(async () => {
    const rawClient = getTestClickHouseClient();
    if (!rawClient) throw new Error("ClickHouse client not available");
    ch = wrapWithDefaultSettings(rawClient);

    await ch.insert({
      table: "trace_summaries",
      values: ALL_TRACES.map(traceSummaryRow),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
    await ch.insert({
      table: "stored_spans",
      values: ALL_SPANS.map(storedSpanRow),
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

  describe("ungrouped totals (the partition target)", () => {
    it("computes the exact ungrouped totals from trace summaries", async () => {
      const cost = await runQuery(ch, sumSeries("performance.total_cost"));
      expect(
        currentValue(cost, "0__performance_total_cost__sum"),
      ).toBeCloseTo(EXPECTED_TOTAL_COST, 9);

      const totalTokens = await runQuery(
        ch,
        sumSeries("performance.total_tokens"),
      );
      expect(
        currentValue(totalTokens, "0__performance_total_tokens__sum"),
      ).toBe(EXPECTED_TOTAL_TOKENS);
    });
  });

  describe("bug 1: groupBy metadata.model partitions cost and tokens", () => {
    it("attributes cost per span-level model; buckets sum to the exact ungrouped total", async () => {
      const rows = await runQuery(
        ch,
        sumSeries("performance.total_cost"),
        "metadata.model",
      );
      const buckets = bucketsOf(rows, "0__performance_total_cost__sum");

      expect(buckets[MODEL_OPUS]).toBeCloseTo(0.5, 9);
      expect(buckets[MODEL_SONNET]).toBeCloseTo(0.25, 9);
      // The [1m]-suffixed model is its own bucket.
      expect(buckets[MODEL_OPUS_1M]).toBeCloseTo(0.125, 9);
      // Single-model trace + skip-gated trace share the haiku bucket; the
      // redundant-usage copy span must NOT double the bucket.
      expect(buckets[MODEL_HAIKU]).toBeCloseTo(0.0625 + 0.03125, 9);

      const bucketSum = Object.values(buckets).reduce((a, b) => a + b, 0);
      expect(bucketSum).toBeCloseTo(EXPECTED_TOTAL_COST, 9);
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
      expect(Object.values(prompt).reduce((a, b) => a + b, 0)).toBe(
        EXPECTED_PROMPT_TOKENS,
      );

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
      expect(Object.values(completion).reduce((a, b) => a + b, 0)).toBe(
        EXPECTED_COMPLETION_TOKENS,
      );

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
      expect(Object.values(total).reduce((a, b) => a + b, 0)).toBe(
        EXPECTED_TOTAL_TOKENS,
      );
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
      expect(nonBilled[MODEL_OPUS_1M]).toBeCloseTo(0.125, 9);
      expect(nonBilled[MODEL_OPUS] ?? 0).toBeCloseTo(0, 9);
      expect(nonBilled[MODEL_SONNET] ?? 0).toBeCloseTo(0, 9);
      expect(
        Object.values(nonBilled).reduce((a, b) => a + b, 0),
      ).toBeCloseTo(0.125, 9);

      const billed = bucketsOf(
        await runQuery(
          ch,
          sumSeries("performance.cost_billed"),
          "metadata.model",
        ),
        "0__performance_cost_billed__sum",
      );
      expect(billed[MODEL_OPUS]).toBeCloseTo(0.5, 9);
      expect(billed[MODEL_OPUS_1M]).toBeCloseTo(0, 9);
      expect(
        Object.values(billed).reduce((a, b) => a + b, 0),
      ).toBeCloseTo(EXPECTED_TOTAL_COST - 0.125, 9);
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
      const expectedProcessed =
        EXPECTED_TOTAL_TOKENS + 10000 + 500; // + cache read + cache write
      expect(Object.values(processed).reduce((a, b) => a + b, 0)).toBe(
        expectedProcessed,
      );
    });
  });

  describe("model grouping combined with a span-joined filter", () => {
    // The generic stored_spans filter JOIN (alias ss) and the span-model
    // partition JOIN (alias smd) must coexist in one query without breaking
    // the partition property.
    it("keeps exact bucket partition when filtering by span type", async () => {
      resetParamCounter();
      const { sql, params } = buildTimeseriesQuery({
        ...baseInput,
        series: sumSeries("performance.total_cost"),
        groupBy: "metadata.model",
        filters: { "spans.type": ["llm"] },
      });
      const result = await ch.query({
        query: sql,
        query_params: params,
        format: "JSONEachRow",
      });
      const rows = (await result.json()) as ResultRow[];
      const buckets = bucketsOf(rows, "0__performance_total_cost__sum");

      // Every fixture trace has at least one llm span except the model-less
      // one, so the filtered result keeps the same partition.
      expect(buckets[MODEL_OPUS]).toBeCloseTo(0.5, 9);
      expect(buckets[MODEL_SONNET]).toBeCloseTo(0.25, 9);
      expect(buckets[MODEL_OPUS_1M]).toBeCloseTo(0.125, 9);
      expect(buckets[MODEL_HAIKU]).toBeCloseTo(0.0625 + 0.03125, 9);
      const bucketSum = Object.values(buckets).reduce((a, b) => a + b, 0);
      expect(bucketSum).toBeCloseTo(EXPECTED_TOTAL_COST, 9);
    });
  });

  describe("bug 3 (query side): unknown bucket honesty", () => {
    it("counts traces per model without a spurious unknown bucket", async () => {
      const rows = await runQuery(
        ch,
        [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
        "metadata.model",
      );
      const buckets = bucketsOf(rows, "0__metadata_trace_id__cardinality");

      expect(buckets[MODEL_OPUS]).toBe(1);
      expect(buckets[MODEL_SONNET]).toBe(1);
      expect(buckets[MODEL_OPUS_1M]).toBe(1);
      expect(buckets[MODEL_HAIKU]).toBe(2);
      // Only the genuinely model-less trace lands in `unknown`. The other
      // traces all have model-less root spans with zero contribution and must
      // NOT mint an unknown bucket.
      expect(buckets.unknown).toBe(1);
    });
  });

  describe("bug 2: composite metrics survive the grouped dedup transform", () => {
    // metadata.labels grouping exercises the same CTE/dedup path with
    // whole-trace attribution, isolating bug 2 from bug 1's model fix.
    it("total_tokens = prompt + completion under a labels grouping", async () => {
      const rows = await runQuery(
        ch,
        sumSeries("performance.total_tokens"),
        "metadata.labels",
      );
      const buckets = bucketsOf(rows, "0__performance_total_tokens__sum");
      expect(buckets["session-x"]).toBe(7700);
    });

    it("cost_billed subtracts the non-billed portion under a labels grouping", async () => {
      const rows = await runQuery(
        ch,
        sumSeries("performance.cost_billed"),
        "metadata.labels",
      );
      const buckets = bucketsOf(rows, "0__performance_cost_billed__sum");
      expect(buckets["session-x"]).toBeCloseTo(0.875 - 0.125, 9);
    });

    it("cost_non_billed reads the non-billed column under a labels grouping", async () => {
      const rows = await runQuery(
        ch,
        sumSeries("performance.cost_non_billed"),
        "metadata.labels",
      );
      const buckets = bucketsOf(rows, "0__performance_cost_non_billed__sum");
      expect(buckets["session-x"]).toBeCloseTo(0.125, 9);
    });

    it("total_processed_tokens includes cache traffic under a labels grouping", async () => {
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

    it("cache token metrics work under a labels grouping", async () => {
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
