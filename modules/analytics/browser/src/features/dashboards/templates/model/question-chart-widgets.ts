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

/** The median of the known values: the usual level a far-off bucket is read against. */
export const MIDDLE = `function middle(values) {
  const sorted = values.filter(known).toSorted((a, b) => a - b);
  if (sorted.length === 0) return null;
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
}`;

export const TRAFFIC_CODE = widgetCode({
  summary: "Traces per bucket, with the period total and the busiest and quietest buckets.",
  subtitle: "Your agent's requests over time, leaving out tests and playground runs.",
  source: "requests",
  recharts: SERIES_CHART_IMPORTS,
  parts: [...SERIES_PARTS, MIDDLE],
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const points = withBuckets(main, [{ key: "traces", kind: "count" }])
    .map((row) => ({ x: bucketLabel(row.bucket), at: bucketStart(row.bucket),
      traces: num(row.traces) }));
  const total = points.reduce((sum, point) => sum + point.traces, 0);
  const busiest = points.toSorted((a, b) => b.traces - a.traces)[0];
  const label = "requests. Busiest " + bucketUnit() + ": " + busiest.x + ", " +
    count(busiest.traces) + " requests";
  // One bucket over twice the usual (the median one), or under a third of it.
  const usual = middle(points.map((point) => point.traces));
  const quietest = points.toSorted((a, b) => a.traces - b.traces)[0];
  signalProblem(usual > 0 && (usual * 2 < busiest.traces || quietest.traces * 3 < usual));
  return (
    <Panel>
      <Headline value={count(total)} label={label} />
      <SeriesChart points={points} format={count}
        series={[{ key: "traces", label: "Requests", colour: C.orange, bars: true }]} />
    </Panel>
  );`,
});

export const SATISFACTION_CODE = widgetCode({
  summary: "Average satisfaction per bucket, and the period's average against the period before.",
  subtitle:
    "LangWatch reads the tone of each user message, from -1 unhappy to 1 happy, and averages " +
    "it over time.",
  recharts: SERIES_CHART_IMPORTS,
  parts: SERIES_PARTS,
  queries: ["trend", "comparison"],
  body: `  if (trend.data.length === 0) {
    return (
      <Panel>
        <Note>
          No messages scored for satisfaction in this period. LangWatch scores the tone of user
          messages when your app sends them.
        </Note>
      </Panel>
    );
  }
  const score = (value) => (known(value) ? num(value).toFixed(2) : GAP);
  const now = num(comparison.data[0]?.satisfaction);
  const previous = num(comparison.data[0]?.satisfaction_prev);
  const points = withBuckets(trend, ["satisfaction"]).map((row) => ({
    x: bucketLabel(row.bucket), at: bucketStart(row.bucket),
    satisfaction: num(row.satisfaction),
  }));
  let moved;
  points.forEach((point, index) => {
    const before = points[index - 1];
    if (!before || !known(point.satisfaction) || !known(before.satisfaction)) return;
    const step = Math.abs(point.satisfaction - before.satisfaction);
    if (!moved || step > moved.step) moved = { x: point.x, step };
  });
  const mood = (value) => (value > 0.2 ? "Happy" : value < -0.2 ? "Unhappy" : "Neutral");
  let label = "on a scale from -1 to 1";
  if (known(now) && known(previous)) {
    label += ", " + (now >= previous ? "up" : "down") + " from " + score(previous) +
      " in the previous period";
  }
  if (moved) label += ". Biggest move: " + moved.x;
  signalProblem(known(now) && known(previous) && now < previous);
  return (
    <Panel>
      <Headline value={known(now) ? mood(now) + " (" + score(now) + ")" : GAP} label={label} />
      <SeriesChart points={points} format={score}
        series={[{ key: "satisfaction", label: "Satisfaction", colour: C.pink }]} />
    </Panel>
  );`,
});

export const TOKEN_DRIFT_CODE = widgetCode({
  summary: "Prompt and completion tokens per bucket, and how far the total moved first to last.",
  subtitle:
    "Tokens are the units models charge by. A slow rise per request raises your bill without " +
    "more traffic.",
  source: "tokens",
  recharts: SERIES_CHART_IMPORTS,
  parts: SERIES_PARTS,
  queries: ["main"],
  body: `  const series = [{ key: "prompt_tokens", kind: "count" }, { key: "completion_tokens", kind: "count" }];
  const points = withBuckets(main, series).map((row) => ({
    x: bucketLabel(row.bucket), at: bucketStart(row.bucket),
    prompt: num(row.prompt_tokens),
    completion: num(row.completion_tokens),
  }));
  // First and last interval that had traffic: an empty one is not a drop to 0.
  const totals = main.data.map((row) => add(row.prompt_tokens, row.completion_tokens))
    .filter((total) => total > 0);
  if (totals.length === 0) return <Panel><CallToAction /></Panel>;
  const change = drift(totals[0], totals[totals.length - 1]);
  signalProblem(change > 0.1);
  const lines = [
    { key: "prompt", label: "Tokens sent", colour: C.teal },
    { key: "completion", label: "Tokens received", colour: C.orange },
  ];
  return (
    <Panel>
      <Headline value={signed(change)}
        label="tokens, from the start of this period to its end" />
      <SeriesChart points={points} format={count} series={lines} />
    </Panel>
  );`,
});

export const CONVERSATION_LENGTH_CODE = widgetCode({
  summary: "Average traces per conversation in each bucket, and its change first to last.",
  subtitle: "Longer conversations can mean people need more tries to get an answer.",
  recharts: SERIES_CHART_IMPORTS,
  parts: SERIES_PARTS,
  queries: ["main"],
  body: `  if (main.data.length === 0) {
    return (
      <Panel>
        <Note>
          Messages are not grouped into conversations yet. Send a conversation id with each message
          and this fills in.
        </Note>
      </Panel>
    );
  }
  const turns = (value) => (known(value) ? num(value).toFixed(1) : GAP);
  const points = withBuckets(main, ["turns"])
    .map((row) => ({ x: bucketLabel(row.bucket), at: bucketStart(row.bucket),
      turns: num(row.turns) }));
  const first = earliest(points, "turns");
  const last = latest(points, "turns");
  const label = "messages per conversation, " + signed(drift(first, last)) +
    " since the start of this period";
  signalProblem(drift(first, last) > 0.1);
  return (
    <Panel>
      <Headline value={turns(last)} label={label} />
      <SeriesChart points={points} format={turns}
        series={[{ key: "turns", label: "Messages per conversation", colour: C.teal }]} />
    </Panel>
  );`,
});

export const P95_LATENCY_CODE = widgetCode({
  summary: "Response time per bucket against the period's, counting the buckets well above it.",
  subtitle:
    "Marks the times when replies were much slower than usual. The line shows the time 1 in " +
    "20 replies took longer than.",
  source: "requests",
  recharts: SERIES_CHART_IMPORTS,
  parts: SERIES_PARTS,
  queries: ["trend", "period"],
  body: `  if (trend.data.length === 0) return <Panel><CallToAction /></Panel>;
  const p95 = num(period.data[0]?.p95_ms);
  const points = withBuckets(trend, ["p95_ms"]).map((row) => ({
    x: bucketLabel(row.bucket), at: bucketStart(row.bucket),
    p95: num(row.p95_ms),
    period: p95,
  }));
  const label = "lately, when 1 in 20 replies took longer. Usual for this period: " + ms(p95);
  signalProblem(p95 > 0 && points.some((point) => point.p95 > p95 * 1.5));
  const series = [
    { key: "p95", label: "Slowest 1 in 20 replies", colour: C.teal },
    { key: "period", label: "Usual for this period", colour: C.red, dashed: true },
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
  subtitle: "Share of your agent's requests that ended in an error, over time.",
  source: "requests",
  recharts: SERIES_CHART_IMPORTS,
  parts: SERIES_PARTS,
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const points = withBuckets(main, ["error_rate"]).map((row) => ({
    x: bucketLabel(row.bucket), at: bucketStart(row.bucket),
    rate: num(row.error_rate),
  }));
  signalProblem(latest(points, "rate") > earliest(points, "rate"));
  return (
    <Panel>
      <Headline value={pct(latest(points, "rate"))}
        label={"of requests ended in an error lately, from " + pct(earliest(points, "rate")) +
          " at the start of this period"} />
      <SeriesChart points={points} format={(value) => pct(value, 0)}
        series={[{ key: "rate", label: "Requests with an error", colour: C.red }]} />
    </Panel>
  );`,
});

export const LATENCY_SPREAD_CODE = widgetCode({
  summary: "Typical, slow and slowest latency for the period and per bucket, and the tail.",
  subtitle:
    "If the slowest replies take many times the typical one, a few requests hit a slow path " +
    "worth fixing.",
  source: "requests",
  recharts: SERIES_CHART_IMPORTS,
  parts: [...SERIES_PARTS, STAT],
  queries: ["period", "trend"],
  body: `  const spread = period.data[0] || {};
  if (trend.data.length === 0) return <Panel><CallToAction /></Panel>;
  const p50 = num(spread.p50_ms);
  const p99 = num(spread.p99_ms);
  const points = withBuckets(trend, ["p50_ms", "p90_ms", "p99_ms"]).map((row) => ({
    x: bucketLabel(row.bucket), at: bucketStart(row.bucket),
    p50: num(row.p50_ms),
    p90: num(row.p90_ms),
    p99: num(row.p99_ms),
  }));
  const tailRatio = known(ratio(p99, p50)) ? ratio(p99, p50).toFixed(1) + " times" : GAP;
  signalProblem(ratio(p99, p50) >= 5);
  const series = [
    { key: "p50", label: "Typical", colour: C.teal },
    { key: "p90", label: "1 in 10 slower", colour: C.orange },
    { key: "p99", label: "1 in 100 slower", colour: C.red },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8,
        marginBottom: 8 }}>
        <Stat label="Typical reply" value={ms(p50)} />
        <Stat label="1 in 10 took over" value={ms(num(spread.p90_ms))} />
        <Stat label="1 in 100 took over" value={ms(p99)} />
        <Stat label="Slowest vs typical" value={tailRatio} />
      </div>
      <SeriesChart points={points} format={ms} series={series} />
    </Panel>
  );`,
});

export const SPEND_CODE = widgetCode({
  summary: "Spend per bucket, the period total and the most expensive bucket.",
  subtitle:
    "What your agent cost over time. Tests and playground runs are left out. Requests on a " +
    "model with no price add nothing, so the total reads low.",
  source: "models",
  recharts: SERIES_CHART_IMPORTS,
  parts: [...SERIES_PARTS, COMPLETENESS, MIDDLE],
  queries: ["main"],
  body: `  const points = withBuckets(main, [{ key: "cost", kind: "count" }]).map((row) => ({
    x: bucketLabel(row.bucket), at: bucketStart(row.bucket),
    cost: num(row.cost),
  }));
  const total = add(...points.map((point) => point.cost));
  if (!total) return <Panel><CallToAction /></Panel>;
  const priced = points.filter((point) => known(point.cost));
  const priciest = priced.reduce((top, point) => (point.cost > top.cost ? point : top));
  const label = "spent. Most expensive " + bucketUnit() + ": " + priciest.x + ", " +
    usd(priciest.cost);
  const usual = middle(priced.map((point) => point.cost));
  signalProblem(usual > 0 && priciest.cost > usual * 2);
  return (
    <Panel>
      <Headline value={usd(total) + plus(main)} label={label} />
      <SeriesChart points={points} format={usd}
        series={[{ key: "cost", label: "Spend", colour: C.orange, bars: true }]} />
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
  legend,
  problem,
}: {
  summary: string;
  subtitle: string;
  source: WidgetSource;
  noun: string;
  legend: string;
  /** The problem the card watches for, over `passed`, `runs` and the trend's `points`. */
  problem: string;
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
    x: bucketLabel(row.bucket), at: bucketStart(row.bucket),
    rate: num(row.pass_rate),
  }));
  const label = "of ${noun} passed (" + count(passed) + " of " + count(runs) + ")";
  signalProblem(${problem});
  return (
    <Panel>
      <Headline value={pct(passed / runs, 0)} label={label} />
      <SeriesChart points={points} format={(value) => pct(value, 0)} domain={[0, 1]}
        series={[{ key: "rate", label: "${legend}", colour: C.teal }]} />
    </Panel>
  );`,
  });
}

export const EVALUATION_PASS_RATE_CODE = passRateCode({
  summary: "Share of evaluations that passed, for the period and bucket by bucket.",
  subtitle: "Each automatic check you run on your agent's answers, over time.",
  source: "evaluations",
  noun: "automatic checks",
  legend: "Checks passed",
  problem: "passed / runs < 0.8",
});

export const SCENARIO_PASS_RATE_CODE = passRateCode({
  summary: "Share of scenario runs the judge passed, for the period and bucket by bucket.",
  subtitle: "Share of test runs that passed, over time.",
  source: "scenarios",
  noun: "test runs",
  legend: "Tests passed",
  problem: 'latest(points, "rate") < earliest(points, "rate")',
});
