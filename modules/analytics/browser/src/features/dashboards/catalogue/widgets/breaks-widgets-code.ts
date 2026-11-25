/**
 * Stored TSX for "Where my agent breaks": errors over time with changes marked, the
 * steps and tools that fail and whether the agent recovered, loops and retries, and
 * how often a judge says the first tool was wrong.
 */

import {
  BARS,
  BUCKETS,
  CHART_STYLE,
  DATES,
  GAP_BRIDGE,
  HEADLINE,
  MARK_HOVER,
  NUMBERS,
  SERIES_CHART,
  SERIES_CHART_IMPORTS,
  STAT,
  widgetCode,
} from "../../templates/model/widget-code-parts.ts";
import { WRONG_TOOL_JUDGE } from "./breaks-queries.ts";
import { SETUP_NOTE } from "./setup-note.ts";

/** A chart that also marks changes, so it imports the reference line too. */
const MARKED_CHART_IMPORTS = [...SERIES_CHART_IMPORTS, "ReferenceLine"] as const;

/**
 * Stacked bars on the left axis, an optional line on its own axis, and a dashed
 * vertical line at each change; reads `CHART_STYLE`, `DATES`, `GAP_BRIDGE` and `MARK_HOVER`.
 */
const MARKED_CHART = `// marks: the changes query's rows; one line per bucket, its labels joined.
function changeMarks(rows) {
  const byBucket = {};
  rows.forEach((row) => {
    const x = bucketLabel(row.bucket);
    byBucket[x] = byBucket[x] ? byBucket[x] + ", " + row.label : row.label;
  });
  return Object.entries(byBucket).map(([x, label]) => ({ x, label }));
}

function MarkedChart({ points, bars, line, marks, barFormat, lineFormat }) {
  const legend = [
    ...bars.map((item) => [item.colour, item.label]),
    ...(line ? [[line.colour, line.label]] : []),
    ...(marks.length > 0 ? [[C.faint, "prompt or model change", true]] : []),
  ];
  const lineAxis = bars.length > 0 ? "line" : "bars";
  const barsFormat = bars.length > 0 ? barFormat : lineFormat;
  // A click asks about the bucket under the pointer and the bar hit; with one series, that one.
  const drawn = [...bars, ...(line ? [line] : [])];
  let pointed = null;
  const onClick = (state) => {
    const index = state?.activeTooltipIndex;
    const at = index == null ? undefined : points[Number(index)];
    const hit = pointed ?? (drawn.length === 1 ? drawn[0].label : null);
    pointed = null;
    if (!at) return;
    askLangy({ kind: "day", label: String(at.x), ...(at.at ? { at: at.at } : {}),
      ...(hit ? { series: hit } : {}) });
  };
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Legend items={legend} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}
            onClick={canAskLangy() && points.length > 0 ? onClick : undefined} style={askCursor()}>
            <CartesianGrid vertical={false} stroke={C.border} />
            <XAxis dataKey="x" tick={AXIS} tickLine={false} axisLine={false} minTickGap={28}
              dy={4} />
            <YAxis yAxisId="bars" tick={AXIS} tickLine={false} axisLine={false} width={48}
              tickFormatter={barsFormat} allowDecimals={barsFormat !== count} />
            {bars.length > 0 && line && (
              <YAxis yAxisId="line" orientation="right" tick={AXIS} tickLine={false}
                axisLine={false} width={48} tickFormatter={lineFormat} />
            )}
            <Tooltip contentStyle={TIP} filterNull={false} formatter={(value, name) =>
              tipValue(name === line?.label ? lineFormat : barFormat)(value, name)} />
            {bars.map((item) => (
              <Bar key={item.key} yAxisId="bars" dataKey={item.key} name={item.label}
                stackId="bars" fill={item.colour} isAnimationActive={false}
                onClick={() => { pointed = item.label; }} />
            ))}
            {line && bridge({ ...line, yAxisId: lineAxis })}
            {line && (
              <Line yAxisId={lineAxis} type="monotone" dataKey={line.key} name={line.label}
                stroke={line.colour} strokeWidth={2} dot={false} isAnimationActive={false} />
            )}
            {marks.map((mark) => (
              <ReferenceLine key={mark.x} yAxisId="bars" x={mark.x} stroke={C.faint}
                strokeDasharray="4 3" label={markHover(mark.label)} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}`;

const MARKED_PARTS = [
  NUMBERS,
  DATES,
  CHART_STYLE,
  HEADLINE,
  BUCKETS,
  GAP_BRIDGE,
  MARK_HOVER,
  MARKED_CHART,
];

export const ERRORS_PER_DAY_CODE = widgetCode({
  summary: "Traces with an error per bucket by what failed first, the error rate, and changes.",
  subtitle:
    "Failed requests over time, by error. Lines mark a new prompt version or model: if a spike " +
    "starts at one, look there first.",
  source: "traces",
  recharts: MARKED_CHART_IMPORTS,
  parts: MARKED_PARTS,
  components: `const SHOWN = 4;
const COLOURS = [C.red, C.orange, C.pink, "#9f7aea", C.faint];`,
  queries: ["types", "rate", "changes"],
  body: `  if (rate.data.length === 0) return <Panel><CallToAction /></Panel>;
  const totals = {};
  types.data.forEach((row) => {
    totals[row.category] = (totals[row.category] || 0) + num(row.traces);
  });
  const ranked = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
  const keyOf = (category) => (ranked.indexOf(category) < SHOWN ? category : "Other");
  const keys = [...ranked.slice(0, SHOWN), ...(ranked.length > SHOWN ? ["Other"] : [])];
  const byBucket = {};
  types.data.forEach((row) => {
    const point = byBucket[bucketLabel(row.bucket)] || {};
    point[keyOf(row.category)] = (point[keyOf(row.category)] || 0) + num(row.traces);
    byBucket[bucketLabel(row.bucket)] = point;
  });
  const points = withBuckets(rate, ["error_rate"]).map((row) => ({
    x: bucketLabel(row.bucket), at: bucketStart(row.bucket),
    rate: num(row.error_rate),
    ...byBucket[bucketLabel(row.bucket)],
  }));
  const errored = Object.values(totals).reduce((sum, value) => sum + value, 0);
  const bars = keys.map((key, index) => ({ key, label: key, colour: COLOURS[index] }));
  const line = { key: "rate", label: "Share with an error", colour: C.teal };
  const label = "requests failed" + (ranked.length > 0 ? ". Most common: " + ranked[0] : "");
  // A spike: a bucket's error rate at least twice the typical bucket's.
  const rates = points.map((point) => point.rate).filter(known).toSorted((a, b) => a - b);
  const typical = rates[Math.floor(rates.length / 2)] ?? 0;
  signalProblem(errored > 0 && (rates[rates.length - 1] ?? 0) > 2 * typical);
  return (
    <Panel>
      <Headline value={count(errored)} label={label} />
      <MarkedChart points={points} bars={bars} line={line} marks={changeMarks(changes.data)}
        barFormat={count} lineFormat={(value) => pct(value)} />
    </Panel>
  );`,
});

/** Failure bars split into what reached the user and what the agent recovered. */
const FAILURE_ROWS = `function FailureRows({ rows }) {
  const max = Math.max(...rows.map((row) => row.failures), 1);
  const split = (value, colour) => ({ width: (value / max) * 100 + "%", background: colour });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((row) => (
        <div key={row.step} {...askable({ kind: "step", label: row.step })} style={askCursor()}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 11.5 }}>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
              whiteSpace: "nowrap" }}>"{row.step}"</span>
            <span style={{ fontSize: 10.5, color: C.faint }}>
              fails {pct(row.failures / row.calls)} of {count(row.calls)} calls,{" "}
              {count(row.failures - row.recovered)} times the user saw it
            </span>
            <span style={{ width: 40, textAlign: "right", fontWeight: 600 }}>
              {count(row.failures - row.recovered)}
            </span>
          </div>
          <div style={{ display: "flex", height: 6, marginTop: 2, borderRadius: 3,
            overflow: "hidden", background: C.muted }}>
            <span style={split(row.failures - row.recovered, C.red)} />
            <span style={split(row.recovered, C.orange + "80")} />
          </div>
        </div>
      ))}
    </div>
  );
}

function FailureLegend() {
  return (
    <div style={{ display: "flex", gap: 12, marginTop: "auto", paddingTop: 6, fontSize: 10.5,
      color: C.subtle }}>
      <span><b style={{ color: C.red }}>■</b> User saw the failure</span>
      <span><b style={{ color: C.orange }}>■</b> Agent recovered</span>
    </div>
  );
}
`;

/** A step-failures row with its counts as numbers. */
const FAILURE_ROW = `const failureRow = (row) => ({
  step: row.step,
  calls: num(row.calls),
  failures: num(row.failures),
  recovered: num(row.recovered),
});`;

export const FAILING_STEPS_CODE = widgetCode({
  summary: "Steps and tools below the root that failed, how often, and how many reached the user.",
  subtitle: "Fix the step with the most failures that reached the user.",
  source: "spans",
  parts: [NUMBERS],
  components: `${FAILURE_ROW}\n\n${FAILURE_ROWS}`,
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const rows = main.data.map(failureRow).filter((row) => row.failures > 0);
  signalProblem(rows.some((row) => row.failures > row.recovered));
  if (rows.length === 0) return <Panel><Note>No step failed in this period.</Note></Panel>;
  return (
    <Panel>
      <div style={{ fontSize: 10.5, color: C.faint, textAlign: "right", marginBottom: 4 }}>
        User saw it
      </div>
      <FailureRows rows={rows} />
      <FailureLegend />
    </Panel>
  );`,
});

export const TOOL_ERROR_RATE_CODE = widgetCode({
  summary: "Error rate per tool, the share of tool errors the agent recovered, and the worst tool.",
  subtitle: "Fix the tool whose failures users see most.",
  source: "spans",
  parts: [NUMBERS, BARS, STAT],
  components: FAILURE_ROW,
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const tools = main.data.map(failureRow);
  const calls = tools.reduce((sum, tool) => sum + tool.calls, 0);
  const failures = tools.reduce((sum, tool) => sum + tool.failures, 0);
  const recovered = tools.reduce((sum, tool) => sum + tool.recovered, 0);
  // The tool whose failures users saw most first; the rate breaks a tie.
  const seen = (tool) => tool.failures - tool.recovered;
  const ranked = [...tools].sort((a, b) => seen(b) - seen(a) ||
    b.failures / b.calls - a.failures / a.calls);
  const worst = ranked[0];
  const worstLine = failures === 0 ? "No tool failed" : '"' + worst.step + '" fails ' +
    pct(worst.failures / worst.calls) + ", the user saw " +
    count(worst.failures - worst.recovered);
  const bars = ranked.slice(0, 5).map((tool) => ({
    label: tool.step,
    key: tool.step,
    value: tool.failures / tool.calls,
  }));
  signalProblem(failures > recovered);
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        <Stat label={"Tool calls that failed: " + count(failures) + " of " + count(calls)}
          value={pct(ratio(failures, calls))} />
        <Stat label={"Agent recovered from " + count(failures) + " failures"}
          value={failures > 0 ? pct(recovered / failures) : "-"} />
        <Stat label="Users saw most failures" value={failures > 0 ? worst.step : "No tool failed"} />
      </div>
      <div style={{ margin: "8px 0 4px", fontSize: 11, color: C.subtle }}>{worstLine}</div>
      <Bars rows={bars} format={(value) => pct(value)} kind="tool" />
    </Panel>
  );`,
});

export const LOOPS_AND_RETRIES_CODE = widgetCode({
  summary: "Traces that repeat a tool call or retry a failed step, per bucket, and their cost.",
  subtitle:
    "Requests where your agent called the same tool with the same input 3 or more times, or " +
    "retried after a failure. Cap retries on the step that loops most.",
  source: "spans",
  recharts: SERIES_CHART_IMPORTS,
  parts: [NUMBERS, DATES, CHART_STYLE, STAT, BUCKETS, GAP_BRIDGE, SERIES_CHART],
  queries: ["daily", "steps", "totals"],
  body: `  const traffic = num(totals.data[0]?.traces);
  if (!traffic) return <Panel><CallToAction /></Panel>;
  signalProblem(daily.data.length > 0);
  if (daily.data.length === 0) {
    return <Panel><Note>Your agent did not go in circles in this period.</Note></Panel>;
  }
  const counts = ["looped_traces", "retried_traces"].map((key) => ({ key, kind: "count" }));
  const points = withBuckets(daily, counts).map((row) => ({
    x: bucketLabel(row.bucket), at: bucketStart(row.bucket),
    looped: num(row.looped_traces),
    retried: num(row.retried_traces),
  }));
  const repeated = points.reduce((sum, point) => sum + point.looped + point.retried, 0);
  const repeatCost = daily.data.reduce((sum, row) => sum + num(row.cost), 0);
  // A repeat with no cost on its spans leaves the sum short of the real cost. The rows cannot
  // tell none priced from priced at 0, so a sum of 0 names the gap instead of "Not priced".
  const unpriced = daily.data.some((row) => num(row.uncosted_spans) > 0);
  const spend = num(totals.data[0]?.cost);
  const series = [
    { key: "looped", label: "Same tool, same input, 3 or more times", colour: C.teal,
      bars: true },
    { key: "retried", label: "Tried again after a failure", colour: C.orange, bars: true },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8,
        marginBottom: 8 }}>
        <Stat label={"Went in circles or retried: " + pct(repeated / traffic) + " of requests"}
          value={count(repeated)} />
        <Stat label={"Cost of the repeats: " + pct(ratio(repeatCost, spend)) +
          " of spend"} value={costText({ sum: repeatCost, priced: true, unpriced })} />
        <div style={{ minWidth: 0, fontSize: 11 }}>
          <div style={{ fontSize: 10, color: C.faint }}>Most repeated steps</div>
          {steps.data.map((row) => (
            <div key={row.step} style={{ display: "flex", justifyContent: "space-between",
              gap: 6 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                fontFamily: "ui-monospace, monospace" }}>{row.step}</span>
              <span style={{ color: C.subtle }}>{count(num(row.traces))}</span>
            </div>
          ))}
        </div>
      </div>
      <SeriesChart points={points} series={series} format={count} />
    </Panel>
  );`,
});

export const WRONG_TOOL_CODE = widgetCode({
  summary: `Share of judged tasks per bucket whose first tool the "${WRONG_TOOL_JUDGE}" judge marked wrong.`,
  subtitle:
    "Share of tasks where your agent's first tool was the wrong one. If it rises, rewrite the " +
    "tool descriptions.",
  source: "evaluations",
  recharts: MARKED_CHART_IMPORTS,
  parts: MARKED_PARTS,
  queries: ["trend", "halves", "changes"],
  components: SETUP_NOTE,
  body: `  if (trend.data.length === 0) {
    return (
      <Panel>
        <SetupNote line={'Not checked yet. Add a check named "${WRONG_TOOL_JUDGE}" that fails a task ' +
          "whose first tool was wrong."}>
          <button style={BUTTON} onClick={() => LW.navigate("onlineEvaluations", {})}>
            Turn on the tool choice check
          </button>
        </SetupNote>
      </Panel>
    );
  }
  const totals = halves.data[0] || {};
  const judged = num(totals.judged);
  const firstJudged = num(totals.judged_first);
  const first = ratio(totals.wrong_first, firstJudged);
  const secondJudged = judged - firstJudged;
  const second = ratio(num(totals.wrong) - num(totals.wrong_first), secondJudged);
  const points = withBuckets(trend, ["wrong_rate"])
    .map((row) => ({ x: bucketLabel(row.bucket), at: bucketStart(row.bucket),
      wrong: num(row.wrong_rate) }));
  const label = "of tasks started with the wrong tool, " + pct(first) +
    " earlier in this period, " + pct(second) + " lately";
  signalProblem(known(first) && known(second) && second > first);
  return (
    <Panel>
      <Headline value={pct(ratio(totals.wrong, judged))} label={label} />
      <MarkedChart points={points} bars={[]} marks={changeMarks(changes.data)}
        line={{ key: "wrong", label: "Started with the wrong tool", colour: C.red }}
        lineFormat={(value) => pct(value)} />
    </Panel>
  );`,
});
