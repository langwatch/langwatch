/**
 * Stored TSX for the question templates' time-series panels: one big figure that
 * answers the question, over a chart of the same measure bucket by bucket.
 */

import {
  BUCKETS,
  CHART_STYLE,
  COMPLETENESS,
  DATES,
  GAP_BRIDGE,
  HEADLINE,
  NUMBERS,
  SERIES_CHART,
  SERIES_CHART_IMPORTS,
  STAT,
  widgetCode,
  type WidgetSource,
} from "./widget-code-parts.ts";

const SERIES_PARTS = [NUMBERS, DATES, CHART_STYLE, HEADLINE, BUCKETS, GAP_BRIDGE, SERIES_CHART];

export const TRAFFIC_CODE = widgetCode({
  summary: "Traces per bucket, with the period total and the busiest and quietest buckets.",
  subtitle: "Every trace that arrived, interval by interval. An interval with no traces reads 0",
  source: "requests",
  recharts: SERIES_CHART_IMPORTS,
  parts: SERIES_PARTS,
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const points = withBuckets(main, [{ key: "traces", kind: "count" }])
    .map((row) => ({ x: bucketLabel(row.bucket), traces: num(row.traces) }));
  const total = points.reduce((sum, point) => sum + point.traces, 0);
  const busiest = points.toSorted((a, b) => b.traces - a.traces)[0];
  const label = "traces · busiest " + busiest.x + " (" + count(busiest.traces) + ")";
  return (
    <Panel>
      <Headline value={count(total)} label={label} />
      <SeriesChart points={points} format={count}
        series={[{ key: "traces", label: "traces", colour: C.orange, bars: true }]} />
    </Panel>
  );`,
});

export const SATISFACTION_CODE = widgetCode({
  summary: "Average satisfaction per bucket, and the period's average against the period before.",
  subtitle:
    "Weekly drift is easy to miss without a line to read it from. An interval with no scored " +
    "trace is a gap in the line",
  recharts: SERIES_CHART_IMPORTS,
  parts: SERIES_PARTS,
  queries: ["trend", "comparison"],
  body: `  if (trend.data.length === 0) {
    return <Panel><Note>No satisfaction scores in this period.</Note></Panel>;
  }
  const score = (value) => (known(value) ? num(value).toFixed(2) : GAP);
  const now = num(comparison.data[0]?.satisfaction);
  const previous = num(comparison.data[0]?.satisfaction_prev);
  const points = withBuckets(trend, ["satisfaction"]).map((row) => ({
    x: bucketLabel(row.bucket),
    satisfaction: num(row.satisfaction),
  }));
  let moved;
  points.forEach((point, index) => {
    const before = points[index - 1];
    if (!before || !known(point.satisfaction) || !known(before.satisfaction)) return;
    const step = Math.abs(point.satisfaction - before.satisfaction);
    if (!moved || step > moved.step) moved = { x: point.x, step };
  });
  let label = "average satisfaction";
  if (known(previous)) label += ", was " + score(previous) + " the period before";
  if (moved) label += " · biggest move at " + moved.x;
  return (
    <Panel>
      <Headline value={score(now)} label={label} />
      <SeriesChart points={points} format={score}
        series={[{ key: "satisfaction", label: "satisfaction", colour: C.pink }]} />
    </Panel>
  );`,
});

export const TOKEN_DRIFT_CODE = widgetCode({
  summary: "Prompt and completion tokens per bucket, and how far the total moved first to last.",
  subtitle: "Slow creep in tokens is a budget problem before it is a spend problem",
  source: "tokens",
  recharts: SERIES_CHART_IMPORTS,
  parts: SERIES_PARTS,
  queries: ["main"],
  body: `  const series = [{ key: "prompt_tokens", kind: "count" }, { key: "completion_tokens", kind: "count" }];
  const points = withBuckets(main, series).map((row) => ({
    x: bucketLabel(row.bucket),
    prompt: num(row.prompt_tokens),
    completion: num(row.completion_tokens),
  }));
  // First and last interval that had traffic: an empty one is not a drop to 0.
  const totals = main.data.map((row) => add(row.prompt_tokens, row.completion_tokens))
    .filter((total) => total > 0);
  if (totals.length === 0) return <Panel><CallToAction /></Panel>;
  const change = drift(totals[0], totals[totals.length - 1]);
  let direction = known(change) ? "flat" : "not enough data";
  if (change > 0.05) direction = "drifting up";
  if (change < -0.05) direction = "drifting down";
  const lines = [
    { key: "prompt", label: "prompt tokens", colour: C.teal },
    { key: "completion", label: "completion tokens", colour: C.orange },
  ];
  return (
    <Panel>
      <Headline value={signed(change)} label={"tokens, first interval to last: " + direction} />
      <SeriesChart points={points} format={count} series={lines} />
    </Panel>
  );`,
});

export const CONVERSATION_LENGTH_CODE = widgetCode({
  summary: "Average traces per conversation in each bucket, and its change first to last.",
  subtitle: "More turns per thread can mean users are not getting answers",
  recharts: SERIES_CHART_IMPORTS,
  parts: SERIES_PARTS,
  queries: ["main"],
  body: `  if (main.data.length === 0) {
    return <Panel><Note>No conversations in this period.</Note></Panel>;
  }
  const turns = (value) => (known(value) ? num(value).toFixed(1) : GAP);
  const points = withBuckets(main, ["turns"])
    .map((row) => ({ x: bucketLabel(row.bucket), turns: num(row.turns) }));
  const first = earliest(points, "turns");
  const last = latest(points, "turns");
  const label = "turns per conversation lately, " + signed(drift(first, last)) + " since the first";
  return (
    <Panel>
      <Headline value={turns(last)} label={label} />
      <SeriesChart points={points} format={turns}
        series={[{ key: "turns", label: "turns per conversation", colour: C.teal }]} />
    </Panel>
  );`,
});

export const P95_LATENCY_CODE = widgetCode({
  summary: "Response time per bucket against the period's, counting the buckets well above it.",
  subtitle:
    "A latency breach needs a live answer, not a retrospective one. Response time is the 95th " +
    "percentile: 1 in 20 traces took longer",
  source: "requests",
  recharts: SERIES_CHART_IMPORTS,
  parts: SERIES_PARTS,
  queries: ["trend", "period"],
  body: `  if (trend.data.length === 0) return <Panel><CallToAction /></Panel>;
  const p95 = num(period.data[0]?.p95_ms);
  const points = withBuckets(trend, ["p95_ms"]).map((row) => ({
    x: bucketLabel(row.bucket),
    p95: num(row.p95_ms),
    period: p95,
  }));
  const label = "response time lately, " + ms(p95) + " over the period";
  const series = [
    { key: "p95", label: "response time", colour: C.teal },
    { key: "period", label: "over the period", colour: C.red, dashed: true },
  ];
  return (
    <Panel>
      <Headline value={ms(latest(points, "p95"))} label={label} />
      <SeriesChart points={points} format={ms} series={series} />
    </Panel>
  );`,
});

export const ERROR_RATE_CODE = widgetCode({
  summary: "Share of traces ending in an error per bucket, with the latest and first rates.",
  subtitle: "Catch a rising error rate the day it starts",
  source: "requests",
  recharts: SERIES_CHART_IMPORTS,
  parts: SERIES_PARTS,
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const points = withBuckets(main, ["error_rate"]).map((row) => ({
    x: bucketLabel(row.bucket),
    rate: num(row.error_rate),
  }));
  return (
    <Panel>
      <Headline value={pct(latest(points, "rate"))}
        label={"error rate lately, from " + pct(earliest(points, "rate")) + " at the start"} />
      <SeriesChart points={points} format={(value) => pct(value, 0)}
        series={[{ key: "rate", label: "error rate", colour: C.red }]} />
    </Panel>
  );`,
});

export const LATENCY_SPREAD_CODE = widgetCode({
  summary: "Typical, slow and slowest latency for the period and per bucket, and the tail.",
  subtitle:
    "Typical, slow and slowest side by side show how long the tail is. Typical is the median " +
    "(p50), slow the 90th percentile (p90) and slowest the 99th (p99)",
  source: "requests",
  recharts: SERIES_CHART_IMPORTS,
  parts: [...SERIES_PARTS, STAT],
  queries: ["period", "trend"],
  body: `  const spread = period.data[0] || {};
  if (trend.data.length === 0) return <Panel><CallToAction /></Panel>;
  const p50 = num(spread.p50_ms);
  const p99 = num(spread.p99_ms);
  const points = withBuckets(trend, ["p50_ms", "p90_ms", "p99_ms"]).map((row) => ({
    x: bucketLabel(row.bucket),
    p50: num(row.p50_ms),
    p90: num(row.p90_ms),
    p99: num(row.p99_ms),
  }));
  const tailRatio = known(ratio(p99, p50)) ? ratio(p99, p50).toFixed(1) + "×" : GAP;
  const series = [
    { key: "p50", label: "typical", colour: C.teal },
    { key: "p90", label: "slow", colour: C.orange },
    { key: "p99", label: "slowest", colour: C.red },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8,
        marginBottom: 8 }}>
        <Stat label="Typical" value={ms(p50)} />
        <Stat label="Slow" value={ms(num(spread.p90_ms))} />
        <Stat label="Slowest" value={ms(p99)} />
        <Stat label="Slowest against typical" value={tailRatio} />
      </div>
      <SeriesChart points={points} format={ms} series={series} />
    </Panel>
  );`,
});

export const SPEND_CODE = widgetCode({
  summary: "Spend per bucket, the period total and the most expensive bucket.",
  subtitle:
    "Spot spend before the invoice does. A total with traces on a model with no price is a " +
    "lower bound, marked +",
  source: "models",
  recharts: SERIES_CHART_IMPORTS,
  parts: [...SERIES_PARTS, COMPLETENESS],
  queries: ["main"],
  body: `  const points = withBuckets(main, [{ key: "cost", kind: "count" }]).map((row) => ({
    x: bucketLabel(row.bucket),
    cost: num(row.cost),
  }));
  const total = add(...points.map((point) => point.cost));
  if (!total) return <Panel><CallToAction /></Panel>;
  const priced = points.filter((point) => known(point.cost));
  const priciest = priced.reduce((top, point) => (point.cost > top.cost ? point : top));
  const label = "spent · most expensive " + priciest.x + " (" + usd(priciest.cost) + ")";
  return (
    <Panel>
      <Headline value={usd(total) + plus(main)} label={label} />
      <SeriesChart points={points} format={usd}
        series={[{ key: "cost", label: "spend", colour: C.orange, bars: true }]} />
    </Panel>
  );`,
});

/**
 * A pass rate per bucket under the period's rate, for any source whose `summary`
 * returns `passed` and `runs` and whose `trend` returns `bucket` and `pass_rate`.
 */
function passRateCode({
  summary,
  subtitle,
  source,
  noun,
}: {
  summary: string;
  subtitle: string;
  source: WidgetSource;
  noun: string;
}) {
  return widgetCode({
    summary,
    subtitle,
    source,
    recharts: SERIES_CHART_IMPORTS,
    parts: SERIES_PARTS,
    queries: ["totals", "trend"],
    body: `  const runs = num(totals.data[0]?.runs);
  if (!runs) return <Panel><CallToAction /></Panel>;
  const passed = num(totals.data[0]?.passed);
  const points = withBuckets(trend, ["pass_rate"]).map((row) => ({
    x: bucketLabel(row.bucket),
    rate: num(row.pass_rate),
  }));
  const label = count(passed) + " of " + count(runs) + " ${noun} passed";
  return (
    <Panel>
      <Headline value={pct(passed / runs, 0)} label={label} />
      <SeriesChart points={points} format={(value) => pct(value, 0)} domain={[0, 1]}
        series={[{ key: "rate", label: "pass rate", colour: C.teal }]} />
    </Panel>
  );`,
  });
}

export const EVALUATION_PASS_RATE_CODE = passRateCode({
  summary: "Share of evaluations that passed, for the period and bucket by bucket.",
  subtitle: "Share of evaluations that passed, interval by interval",
  source: "evaluations",
  noun: "evaluations",
});

export const SCENARIO_PASS_RATE_CODE = passRateCode({
  summary: "Share of scenario runs the judge passed, for the period and bucket by bucket.",
  subtitle: "Share of scenario runs the judge passed",
  source: "scenarios",
  noun: "scenario runs",
});
