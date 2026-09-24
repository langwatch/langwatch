/**
 * Headline trace-count parity between the legacy analytics pipeline and the
 * Analytics v2 "Trace count over time" widget, over the same fixed period.
 *
 * Both counts are read through the real signed-in session, hitting the real
 * tRPC endpoints each surface actually calls:
 *  - legacy: `analytics.getTimeseries` (the query `UserMetrics`'s "Traces"
 *    line chart runs), summed over the window's buckets.
 *  - v2: `analytics.lwql.query`, run with the *exact* SQL statement
 *    `ANALYTICS_V2_WIDGETS`'s `trace-count-over-time` widget declares (see
 *    `~/features/analytics-v2/widgets.ts`), summed over the returned rows.
 *
 * The two pipelines count traces differently on purpose: legacy's
 * `metadata.trace_id` cardinality has no duration filter, while the v2 SQL
 * requires `TotalDurationMs > 0`. If local data makes the two numbers
 * diverge, that divergence is itself the interesting result — this test
 * reports both numbers rather than silently reconciling them.
 *
 * @see specs/analytics/analytics-v2.feature — "Headline numbers match the
 *   legacy analytics for the same period"
 */

import { expect, test } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5570";
const PROJECT_ID = process.env.LANGY_PROJECT_ID ?? "local-dev-project";

// A fixed, absolute window covering the seeded local trace data
// (~244 traces between 2026-08-25 and 2026-09-18), so both pipelines read
// over the identical period regardless of "now".
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

test.describe("Analytics v2 headline parity", () => {
  /** @scenario Headline numbers match the legacy analytics for the same period */
  test("the trace count read through the legacy analytics pipeline equals the Analytics v2 query, for the same fixed period", async ({
    request,
  }) => {
    const legacyResult = await trpcQuery<{
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
    const legacyTraceCount = sumLegacyBuckets(legacyResult.currentPeriod);

    const v2Result = await trpcMutation<{
      rows: Array<{ traces?: number }>;
    }>({
      request,
      procedure: "analytics.lwql.query",
      input: {
        projectId: PROJECT_ID,
        sql: TRACE_COUNT_SQL,
        timeWindow: {
          start: PERIOD_START.toISOString(),
          end: PERIOD_END.toISOString(),
        },
      },
    });
    const v2TraceCount = v2Result.rows.reduce(
      (sum, row) => sum + (row.traces ?? 0),
      0,
    );

    console.log(
      `legacy (metadata.trace_id, no duration filter): ${legacyTraceCount}`,
    );
    console.log(
      `analytics v2 (TotalDurationMs > 0 filter):       ${v2TraceCount}`,
    );

    // The v2 widget's SQL additionally requires TotalDurationMs > 0, which
    // the legacy metadata.trace_id cardinality does not apply — so the two
    // counts are only guaranteed equal when every trace in the window has a
    // recorded duration. Verified against the local seed data (2026-08-25 to
    // 2026-09-18, ~244 traces): both pipelines return exactly 244, i.e. no
    // trace in that window has TotalDurationMs <= 0, so the filter is a
    // no-op here and the spec's "the two counts are equal" holds as a
    // strict equality. A future seed that includes a zero-duration trace
    // would make v2's count strictly lower by construction (the widget's
    // own filter working as declared) — that would be a legitimate
    // assertion failure to revisit, not a flake to relax away.
    expect(v2TraceCount).toBeLessThanOrEqual(legacyTraceCount);
    expect(v2TraceCount).toBe(legacyTraceCount);
  });
});
