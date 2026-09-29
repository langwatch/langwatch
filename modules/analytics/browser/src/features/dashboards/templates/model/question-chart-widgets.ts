/**
 * Stored TSX for the question templates' time-series panels: one big figure that
 * answers the question, over a chart of the same measure bucket by bucket.
 */

import {
  CHART_STYLE,
  DATES,
  HEADLINE,
  NUMBERS,
  SERIES_CHART,
  SERIES_CHART_IMPORTS,
  STAT,
  widgetCode,
  type WidgetSource,
} from "./widget-code-parts.ts";

const SERIES_PARTS = [NUMBERS, DATES, CHART_STYLE, HEADLINE, SERIES_CHART];

export const TRAFFIC_CODE = widgetCode({
  summary: "Traces per bucket, with the period total and the busiest and quietest buckets.",
  subtitle: "Every trace that arrived, interval by interval",
  source: "requests",
  recharts: SERIES_CHART_IMPORTS,
  parts: SERIES_PARTS,
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const points = main.data.map((row) => ({ x: bucketLabel(row.bucket), traces: num(row.traces) }));
  const total = points.reduce((sum, point) => sum + point.traces, 0);
  const ranked = [...points].sort((a, b) => b.traces - a.traces);
  const busiest = ranked[0];
  const quietest = ranked[ranked.length - 1];
  const label = "traces · busiest " + busiest.x + " (" + count(busiest.traces) + "), quietest " +
    quietest.x + " (" + count(quietest.traces) + ")";
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
  subtitle: "Weekly drift is easy to miss without a line to read it from",
  source: "satisfaction",
  recharts: SERIES_CHART_IMPORTS,
  parts: SERIES_PARTS,
  queries: ["trend", "comparison"],
  body: `  if (trend.data.length === 0) return <Panel><CallToAction /></Panel>;
  const score = (value) => num(value).toFixed(2);
  const now = num(comparison.data[0]?.satisfaction);
  const previous = num(comparison.data[0]?.satisfaction_prev);
  const points = trend.data.map((row) => ({
    x: bucketLabel(row.bucket),
    satisfaction: num(row.satisfaction),
  }));
  let moved;
  points.forEach((point, index) => {
    if (index === 0) return;
    const step = Math.abs(point.satisfaction - points[index - 1].satisfaction);
    if (!moved || step > moved.step) moved = { x: point.x, step };
  });
  let label = "average satisfaction";
  if (previous !== 0) {
    const delta = now - previous;
    label += ", " + (delta >= 0 ? "+" : "") + delta.toFixed(2) + " against the period before";
  }
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
  body: `  const points = main.data.map((row) => ({
    x: bucketLabel(row.bucket),
    prompt: num(row.prompt_tokens),
    completion: num(row.completion_tokens),
  }));
  const totals = points.map((point) => point.prompt + point.completion);
  if (totals.every((total) => total === 0)) return <Panel><CallToAction /></Panel>;
  const change = drift(totals[0], totals[totals.length - 1]);
  let direction = "flat";
  if (change > 0.05) direction = "drifting up";
  if (change < -0.05) direction = "drifting down";
  const series = [
    { key: "prompt", label: "prompt tokens", colour: C.teal },
    { key: "completion", label: "completion tokens", colour: C.orange },
  ];
  return (
    <Panel>
      <Headline value={signed(change)} label={"tokens, first bucket to last: " + direction} />
      <SeriesChart points={points} format={count} series={series} />
    </Panel>
  );`,
});

export const CONVERSATION_LENGTH_CODE = widgetCode({
  summary: "Average traces per conversation in each bucket, and its change first to last.",
  subtitle: "More turns per thread can mean users are not getting answers",
  source: "conversations",
  recharts: SERIES_CHART_IMPORTS,
  parts: SERIES_PARTS,
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const turns = (value) => num(value).toFixed(1);
  const points = main.data.map((row) => ({ x: bucketLabel(row.bucket), turns: num(row.turns) }));
  const first = points[0].turns;
  const last = points[points.length - 1].turns;
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
  summary: "p95 latency per bucket against the period's p95, counting the buckets well above it.",
  subtitle: "A latency breach needs a live answer, not a retrospective one",
  source: "requests",
  recharts: SERIES_CHART_IMPORTS,
  parts: SERIES_PARTS,
  queries: ["trend", "period"],
  body: `  if (trend.data.length === 0) return <Panel><CallToAction /></Panel>;
  const p95 = num(period.data[0]?.p95_ms);
  const points = trend.data.map((row) => ({
    x: bucketLabel(row.bucket),
    p95: num(row.p95_ms),
    period: p95,
  }));
  const latest = points[points.length - 1].p95;
  const above = points.filter((point) => point.p95 > p95 * 1.5).length;
  const label = "p95 in the latest bucket · " + ms(p95) + " over the period · " + above +
    " buckets above 1.5×";
  const series = [
    { key: "p95", label: "p95 latency", colour: C.teal },
    { key: "period", label: "period p95", colour: C.red, dashed: true },
  ];
  return (
    <Panel>
      <Headline value={ms(latest)} label={label} />
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
  const points = main.data.map((row) => ({
    x: bucketLabel(row.bucket),
    rate: num(row.error_rate),
  }));
  const first = points[0].rate;
  const last = points[points.length - 1].rate;
  return (
    <Panel>
      <Headline value={pct(last)}
        label={"error rate lately, from " + pct(first) + " at the start"} />
      <SeriesChart points={points} format={(value) => pct(value, 0)}
        series={[{ key: "rate", label: "error rate", colour: C.red }]} />
    </Panel>
  );`,
});

export const LATENCY_SPREAD_CODE = widgetCode({
  summary: "p50, p90 and p99 latency for the period and per bucket, and how long the tail is.",
  subtitle: "p50, p90 and p99 side by side show how long the tail is",
  source: "requests",
  recharts: SERIES_CHART_IMPORTS,
  parts: [...SERIES_PARTS, STAT],
  queries: ["period", "trend"],
  body: `  const spread = period.data[0] || {};
  if (trend.data.length === 0) return <Panel><CallToAction /></Panel>;
  const p50 = num(spread.p50_ms);
  const p99 = num(spread.p99_ms);
  const points = trend.data.map((row) => ({
    x: bucketLabel(row.bucket),
    p50: num(row.p50_ms),
    p90: num(row.p90_ms),
    p99: num(row.p99_ms),
  }));
  const tail = (point) => (point.p50 > 0 ? point.p99 / point.p50 : 0);
  const longest = points.reduce((worst, point) => (tail(point) > tail(worst) ? point : worst));
  const ratio = p50 > 0 ? (p99 / p50).toFixed(1) + "×" : "-";
  const series = [
    { key: "p50", label: "p50", colour: C.teal },
    { key: "p90", label: "p90", colour: C.orange },
    { key: "p99", label: "p99", colour: C.red },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8,
        marginBottom: 8 }}>
        <Stat label="p50" value={ms(p50)} />
        <Stat label="p90" value={ms(num(spread.p90_ms))} />
        <Stat label="p99" value={ms(p99)} />
        <Stat label="p99 / p50" value={ratio} />
      </div>
      <div style={{ fontSize: 11, color: C.subtle, marginBottom: 4 }}>
        Longest tail at {longest.x}
      </div>
      <SeriesChart points={points} format={ms} series={series} />
    </Panel>
  );`,
});

export const SPEND_CODE = widgetCode({
  summary: "Spend per bucket, the period total and the most expensive bucket.",
  subtitle: "Spot spend before the invoice does",
  source: "models",
  recharts: SERIES_CHART_IMPORTS,
  parts: SERIES_PARTS,
  queries: ["main"],
  body: `  const points = main.data.map((row) => ({
    x: bucketLabel(row.bucket),
    cost: num(row.cost),
  }));
  const total = points.reduce((sum, point) => sum + point.cost, 0);
  if (total === 0) return <Panel><CallToAction /></Panel>;
  const priciest = points.reduce((top, point) => (point.cost > top.cost ? point : top));
  const label = "spent · most expensive " + priciest.x + " (" + usd(priciest.cost) + ")";
  return (
    <Panel>
      <Headline value={usd(total)} label={label} />
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
  if (runs === 0) return <Panel><CallToAction /></Panel>;
  const passed = num(totals.data[0]?.passed);
  const points = trend.data.map((row) => ({
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
