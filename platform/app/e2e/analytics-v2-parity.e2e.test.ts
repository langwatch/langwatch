/**
 * Headline parity between the legacy analytics pipeline and the Analytics v2
 * widgets, over the same fixed period: trace count, total cost, and the
 * latency percentiles.
 *
 * Both sides are read through the real signed-in session, hitting the real
 * tRPC endpoints each surface actually calls:
 *  - legacy: `analytics.getTimeseries`, one call per metric, read back by the
 *    `{index}/{metric}/{aggregation}` series key over the window's buckets.
 *  - v2: `analytics.lwql.query`, run with the *exact* SQL each widget in
 *    `ANALYTICS_V2_WIDGETS` declares (see `~/features/analytics-v2/widgets.ts`).
 *
 * The trace-count pipelines count differently on purpose: legacy's
 * `metadata.trace_id` cardinality has no duration filter, while the v2 SQL
 * requires `TotalDurationMs > 0` — so the two are strictly equal only when
 * every trace in the window has a recorded duration (a future zero-duration
 * trace would make v2 strictly lower by construction). Cost is compared within
 * a small relative tolerance (float sum ordering differs across pipelines);
 * latency percentiles exact within 1 ms, since both sides use quantileExact.
 *
 * @see specs/analytics/analytics-v2.feature — "Headline numbers match the
 *   legacy analytics for the same period"
 */

import { expect, test } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5570";
const PROJECT_ID = process.env.LANGY_PROJECT_ID ?? "local-dev-project";

// A fixed, absolute window, so both pipelines read over the identical period
// regardless of "now".
const PERIOD_START = new Date("2026-08-25T00:00:00.000Z");
const PERIOD_END = new Date("2026-09-19T00:00:00.000Z");

// The exact SQL the "trace-count-over-time" widget declares in
// `~/features/analytics-v2/widgets.ts` — kept as a literal copy here (not an
// import) so this test proves the query the widget actually ships, not
// whatever the widget module happens to export by the time this runs.
const TRACE_COUNT_SQL = `SELECT toStartOfDay(OccurredAt) AS bucket, uniqExact(TraceId) AS traces
FROM trace_metrics
WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime}
  AND TotalDurationMs > 0
GROUP BY bucket
ORDER BY bucket`;

// The exact SQL the "total-cost-over-time" widget declares in
// `~/features/analytics-v2/widgets.ts` — literal copy (see TRACE_COUNT_SQL).
const TOTAL_COST_SQL = `SELECT toStartOfDay(OccurredAt) AS bucket, sum(TotalCost) AS cost
FROM trace_metrics
WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime}
  AND TotalDurationMs > 0
GROUP BY bucket
ORDER BY bucket`;

// The "latency-percentiles" widget SQL from `~/features/analytics-v2/widgets.ts`,
// with its `toStartOfDay(OccurredAt) AS bucket` replaced by `1 AS bucket` so it
// collapses to one whole-window row (p50/p90/p99) to compare against legacy's
// single "full" bucket. Both use quantileExact, so the percentiles match exactly.
const LATENCY_SQL = `SELECT 1 AS bucket,
  quantileExact(0.5)(TotalDurationMs) AS p50,
  quantileExact(0.9)(TotalDurationMs) AS p90,
  quantileExact(0.99)(TotalDurationMs) AS p99
FROM trace_metrics
WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime}
  AND TotalDurationMs > 0
GROUP BY bucket
ORDER BY bucket`;

/** A tRPC query call (GET, single procedure, superjson envelope). */
async function trpcQuery<T>({
  request,
  procedure,
  input,
}: {
  request: import("@playwright/test").APIRequestContext;
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
  request: import("@playwright/test").APIRequestContext;
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
  request: import("@playwright/test").APIRequestContext,
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
  test("the trace count, total cost, and latency percentiles read through the legacy analytics pipeline equal the Analytics v2 queries, for the same fixed period", async ({
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

    // Data-independent: with no traces in the window there is nothing to
    // compare, so skip rather than assert 0 === 0 (a vacuous pass).
    // biome-ignore lint/suspicious/noSkippedTests: intentional runtime skip when the target has no traces in the fixed window, not a disabled test
    test.skip(
      legacyTraceCount === 0,
      "target has no traces in the fixed period — nothing to compare",
    );

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

    // --- Analytics v2: the exact widget SQL, same window ---
    const v2TraceCount = (
      await runLwql<{ traces?: number }>(request, TRACE_COUNT_SQL)
    ).reduce((sum, row) => sum + (row.traces ?? 0), 0);

    const v2Cost = (
      await runLwql<{ cost?: number }>(request, TOTAL_COST_SQL)
    ).reduce((sum, row) => sum + (row.cost ?? 0), 0);

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
      `p50/p90/p99 legacy=${legacyP50}/${legacyP90}/${legacyP99} v2=${v2P50}/${v2P90}/${v2P99}`,
    );

    // Trace count: exact — the v2 SQL's extra TotalDurationMs > 0 filter is a
    // no-op when every trace in the window has a recorded duration.
    expect(v2TraceCount).toBe(legacyTraceCount);

    // Cost: equal within 1e-3 relative (float sum ordering differs).
    expect(Math.abs(v2Cost - legacyCost)).toBeLessThanOrEqual(
      1e-3 * Math.max(v2Cost, legacyCost),
    );

    // Latency: each percentile exact within 1 ms (both use quantileExact).
    expect(Math.abs(v2P50 - legacyP50)).toBeLessThanOrEqual(1);
    expect(Math.abs(v2P90 - legacyP90)).toBeLessThanOrEqual(1);
    expect(Math.abs(v2P99 - legacyP99)).toBeLessThanOrEqual(1);
  });
});
