/**
 * Headline parity between the legacy analytics pipeline and the Analytics v2
 * widgets, over the same fixed period: trace count, total cost, prompt and
 * completion tokens, and the latency percentiles.
 *
 * Both sides are read through the real signed-in session, hitting the real
 * tRPC endpoints each surface actually calls:
 *  - legacy: `analytics.getTimeseries`, one call per metric, read back by the
 *    `{index}/{metric}/{aggregation}` series key over the window's buckets.
 *  - v2: `analytics.lwql.query`, run with the SQL each widget in
 *    `ANALYTICS_V2_WIDGETS` declares (see `~/features/analytics-v2/widgets.ts`),
 *    imported here so this test proves the query the widget actually ships.
 *
 * The widget queries group by day; the legacy comparison wants one bucket for
 * the whole window, so each widget's `toStartOfDay(...) AS bucket` is rewritten
 * to `1 AS bucket` (a single-bucket derivation that is asserted to have changed
 * the SQL, so a widget that stops grouping by day cannot silently pass).
 *
 * @see specs/analytics/analytics-v2.feature — "Headline numbers match the
 *   legacy analytics for the same period"
 */

import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { ANALYTICS_V2_WIDGETS } from "../src/features/analytics-v2/widgets";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5560";
const PROJECT_ID = process.env.LANGY_PROJECT_ID ?? "local-dev-project";

// A fixed, absolute window, so both pipelines read over the identical period
// regardless of "now".
const PERIOD_START = new Date("2026-08-25T00:00:00.000Z");
const PERIOD_END = new Date("2026-09-19T00:00:00.000Z");

/** The SQL the widget with `id` ships, straight from its definition. */
function widgetSql(id: string): string {
  const widget = ANALYTICS_V2_WIDGETS.find((w) => w.id === id);
  if (!widget)
    throw new Error(`widget ${id} not found in ANALYTICS_V2_WIDGETS`);
  const query = widget.definition.queries[0];
  if (!query) throw new Error(`widget ${id} declares no query`);
  return query.sql;
}

/**
 * Collapse a per-day widget query into one whole-window row by replacing its
 * daily bucket expression with a constant. The widgets bucket on either
 * `OccurredAt` (trace_metrics) or `BucketStart` (trace_metrics_by_minute).
 * Asserts the replacement changed the string, so a widget that stops grouping
 * by day fails loudly instead of comparing per-day rows against a total.
 */
function toSingleBucket(sql: string): string {
  const derived = sql
    .replace("toStartOfDay(OccurredAt) AS bucket", "1 AS bucket")
    .replace("toStartOfDay(BucketStart) AS bucket", "1 AS bucket");
  expect(
    derived,
    "single-bucket derivation did not change the widget SQL",
  ).not.toBe(sql);
  return derived;
}

const TRACE_COUNT_SQL = toSingleBucket(widgetSql("trace-count-over-time"));
const TOTAL_COST_SQL = toSingleBucket(widgetSql("total-cost-over-time"));
const TOKENS_SQL = toSingleBucket(widgetSql("tokens-over-time"));
const LATENCY_SQL = toSingleBucket(widgetSql("latency-percentiles"));

/** A tRPC query call (GET, single procedure, superjson envelope). */
async function trpcQuery<T>({
  request,
  procedure,
  input,
}: {
  request: APIRequestContext;
  procedure: string;
  input: unknown;
}): Promise<T> {
  const encoded = encodeURIComponent(JSON.stringify({ json: input }));
  const response = await request.get(
    `${BASE_URL}/api/trpc/${procedure}?input=${encoded}`,
  );
  expect(
    response.ok(),
    `${procedure} query failed: HTTP ${response.status()} ${await response.text()}`,
  ).toBe(true);
  const body = (await response.json()) as { result: { data: { json: T } } };
  return body.result.data.json;
}

/** A tRPC mutation call (POST, batch=1, superjson envelope). */
async function trpcMutation<T>({
  request,
  procedure,
  input,
}: {
  request: APIRequestContext;
  procedure: string;
  input: unknown;
}): Promise<T> {
  const response = await request.post(
    `${BASE_URL}/api/trpc/${procedure}?batch=1`,
    {
      headers: { "Content-Type": "application/json", Origin: BASE_URL },
      data: { "0": { json: input } },
    },
  );
  expect(
    response.ok(),
    `${procedure} mutation failed: HTTP ${response.status()} ${await response.text()}`,
  ).toBe(true);
  const body = (await response.json()) as Array<{
    result: { data: { json: T } };
  }>;
  return body[0]!.result.data.json;
}

/** Sums every numeric field of every legacy timeseries bucket. */
function sumLegacyBuckets(
  buckets: Array<Record<string, number | string | unknown>>,
): number {
  let total = 0;
  for (const bucket of buckets) {
    for (const [key, value] of Object.entries(bucket)) {
      if (key === "date") continue;
      if (typeof value === "number") total += value;
    }
  }
  return total;
}

/**
 * Sums one legacy series' value across every bucket, read by its
 * `{index}/{metric}/{aggregation}` key (the shape `buildSeriesName` emits).
 */
function sumSeries(
  buckets: Array<Record<string, unknown>>,
  key: string,
): number {
  let total = 0;
  for (const bucket of buckets) {
    const value = bucket[key];
    if (typeof value === "number") total += value;
  }
  return total;
}

/** Runs one LWQL statement over the fixed period and returns its rows. */
async function runLwql<T>(
  request: APIRequestContext,
  sql: string,
): Promise<T[]> {
  const result = await trpcMutation<{ rows: T[] }>({
    request,
    procedure: "analytics.lwql.query",
    input: {
      projectId: PROJECT_ID,
      sql,
      timeWindow: {
        start: PERIOD_START.toISOString(),
        end: PERIOD_END.toISOString(),
      },
    },
  });
  return result.rows;
}

test.describe("Analytics v2 headline parity", () => {
  /** @scenario "Headline numbers match the legacy analytics for the same period" */
  test("the trace count, total cost, tokens, and latency percentiles read through the legacy analytics pipeline equal the Analytics v2 queries, for the same fixed period", async ({
    request,
  }) => {
    // --- Legacy analytics: one getTimeseries call per metric ---
    const legacyTraces = await trpcQuery<{
      currentPeriod: Array<Record<string, unknown>>;
    }>({
      request,
      procedure: "analytics.getTimeseries",
      input: {
        projectId: PROJECT_ID,
        startDate: PERIOD_START.getTime(),
        endDate: PERIOD_END.getTime(),
        filters: {},
        series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
        timeScale: "full",
        timeZone: "UTC",
      },
    });
    const legacyTraceCount = sumLegacyBuckets(legacyTraces.currentPeriod);

    // A window with no traces makes every comparison vacuous, so this is a
    // prerequisite the run must satisfy, not a reason to skip.
    expect(
      legacyTraceCount,
      "the fixed window has no traces; seed the local project before running the parity test",
    ).toBeGreaterThan(0);

    const legacyCostResult = await trpcQuery<{
      currentPeriod: Array<Record<string, unknown>>;
    }>({
      request,
      procedure: "analytics.getTimeseries",
      input: {
        projectId: PROJECT_ID,
        startDate: PERIOD_START.getTime(),
        endDate: PERIOD_END.getTime(),
        filters: {},
        series: [
          {
            name: "cost",
            colorSet: "greenTones",
            metric: "performance.total_cost",
            aggregation: "sum",
          },
        ],
        timeScale: "full",
        timeZone: "UTC",
      },
    });
    const legacyCost = sumSeries(
      legacyCostResult.currentPeriod,
      "0/performance.total_cost/sum",
    );

    const legacyTokensResult = await trpcQuery<{
      currentPeriod: Array<Record<string, unknown>>;
    }>({
      request,
      procedure: "analytics.getTimeseries",
      input: {
        projectId: PROJECT_ID,
        startDate: PERIOD_START.getTime(),
        endDate: PERIOD_END.getTime(),
        filters: {},
        series: [
          {
            name: "prompt_tokens",
            colorSet: "blueTones",
            metric: "performance.prompt_tokens",
            aggregation: "sum",
          },
          {
            name: "completion_tokens",
            colorSet: "orangeTones",
            metric: "performance.completion_tokens",
            aggregation: "sum",
          },
        ],
        timeScale: "full",
        timeZone: "UTC",
      },
    });
    const legacyPromptTokens = sumSeries(
      legacyTokensResult.currentPeriod,
      "0/performance.prompt_tokens/sum",
    );
    const legacyCompletionTokens = sumSeries(
      legacyTokensResult.currentPeriod,
      "1/performance.completion_tokens/sum",
    );

    const legacyLatencyResult = await trpcQuery<{
      currentPeriod: Array<Record<string, unknown>>;
    }>({
      request,
      procedure: "analytics.getTimeseries",
      input: {
        projectId: PROJECT_ID,
        startDate: PERIOD_START.getTime(),
        endDate: PERIOD_END.getTime(),
        filters: {},
        series: [
          {
            name: "p50",
            colorSet: "greenTones",
            metric: "performance.completion_time",
            aggregation: "median",
          },
          {
            name: "p90",
            colorSet: "yellowTones",
            metric: "performance.completion_time",
            aggregation: "p90",
          },
          {
            name: "p99",
            colorSet: "redTones",
            metric: "performance.completion_time",
            aggregation: "p99",
          },
        ],
        timeScale: "full",
        timeZone: "UTC",
      },
    });
    // timeScale "full" collapses the window into a single bucket, keyed by
    // {index}/{metric}/{aggregation}; "median" is the legacy id for p50.
    const legacyBucket: Record<string, unknown> =
      legacyLatencyResult.currentPeriod[0] ?? {};
    const legacyP50 = Number(
      legacyBucket["0/performance.completion_time/median"],
    );
    const legacyP90 = Number(legacyBucket["1/performance.completion_time/p90"]);
    const legacyP99 = Number(legacyBucket["2/performance.completion_time/p99"]);

    // --- Analytics v2: the widget SQL collapsed to one bucket, same window ---
    const v2TraceCount = Number(
      (await runLwql<{ traces?: number }>(request, TRACE_COUNT_SQL))[0]
        ?.traces ?? 0,
    );

    const v2Cost = Number(
      (await runLwql<{ cost?: number }>(request, TOTAL_COST_SQL))[0]?.cost ?? 0,
    );

    const v2Tokens: { prompt_tokens?: number; completion_tokens?: number } =
      (
        await runLwql<{
          prompt_tokens?: number;
          completion_tokens?: number;
        }>(request, TOKENS_SQL)
      )[0] ?? {};
    const v2PromptTokens = Number(v2Tokens.prompt_tokens ?? 0);
    const v2CompletionTokens = Number(v2Tokens.completion_tokens ?? 0);

    const v2Latency: { p50?: number; p90?: number; p99?: number } =
      (
        await runLwql<{ p50?: number; p90?: number; p99?: number }>(
          request,
          LATENCY_SQL,
        )
      )[0] ?? {};
    const v2P50 = Number(v2Latency.p50);
    const v2P90 = Number(v2Latency.p90);
    const v2P99 = Number(v2Latency.p99);

    console.log(`traces  legacy=${legacyTraceCount} v2=${v2TraceCount}`);
    console.log(`cost    legacy=${legacyCost} v2=${v2Cost}`);
    console.log(
      `tokens  legacy=${legacyPromptTokens}/${legacyCompletionTokens} v2=${v2PromptTokens}/${v2CompletionTokens}`,
    );
    console.log(
      `p50/p90/p99 legacy=${legacyP50}/${legacyP90}/${legacyP99} v2=${v2P50}/${v2P90}/${v2P99}`,
    );

    expect(v2TraceCount).toBe(legacyTraceCount);

    // Cost: equal within 1e-3 relative (float sum ordering differs).
    expect(Math.abs(v2Cost - legacyCost)).toBeLessThanOrEqual(
      1e-3 * Math.max(v2Cost, legacyCost),
    );

    // Tokens: exact — both sides sum the same per-minute rollup columns.
    expect(v2PromptTokens).toBe(legacyPromptTokens);
    expect(v2CompletionTokens).toBe(legacyCompletionTokens);

    // Latency: each percentile exact within 1 ms (both use quantileExact).
    expect(Math.abs(v2P50 - legacyP50)).toBeLessThanOrEqual(1);
    expect(Math.abs(v2P90 - legacyP90)).toBeLessThanOrEqual(1);
    expect(Math.abs(v2P99 - legacyP99)).toBeLessThanOrEqual(1);
  });
});
