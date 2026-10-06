/**
 * Stored TSX for "Where my agent breaks": errors over time with changes marked, the
 * steps and tools that fail and whether the agent recovered, loops and retries, and
 * how often a judge says the first tool was wrong.
 */

import {
  BARS,
  CHART_STYLE,
  DATES,
  HEADLINE,
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
 * vertical line at each change; reads `CHART_STYLE` and `DATES`.
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
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Legend items={legend} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={C.border} />
            <XAxis dataKey="x" tick={AXIS} tickLine={false} axisLine={false} minTickGap={28}
              dy={4} />
            <YAxis yAxisId="bars" tick={AXIS} tickLine={false} axisLine={false} width={48}
              tickFormatter={bars.length > 0 ? barFormat : lineFormat} />
            {bars.length > 0 && line && (
              <YAxis yAxisId="line" orientation="right" tick={AXIS} tickLine={false}
                axisLine={false} width={48} tickFormatter={lineFormat} />
            )}
            <Tooltip contentStyle={TIP} formatter={(value, name) =>
              [name === line?.label ? lineFormat(value) : barFormat(value), name]} />
            {bars.map((item) => (
              <Bar key={item.key} yAxisId="bars" dataKey={item.key} name={item.label}
                stackId="bars" fill={item.colour} isAnimationActive={false} />
            ))}
            {line && (
              <Line yAxisId={lineAxis} type="monotone" dataKey={line.key} name={line.label}
                stroke={line.colour} strokeWidth={2} dot={false} isAnimationActive={false} />
            )}
            {marks.map((mark) => (
              <ReferenceLine key={mark.x} yAxisId="bars" x={mark.x} stroke={C.faint}
                strokeDasharray="4 3" label={{ value: mark.label, position: "insideTopLeft",
                  fontSize: 10, fill: C.faint }} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}`;

const MARKED_PARTS = [NUMBERS, DATES, CHART_STYLE, HEADLINE, MARKED_CHART];

export const ERRORS_PER_DAY_CODE = widgetCode({
  summary: "Traces with an error per bucket by what failed first, the error rate, and changes.",
  subtitle:
    "Errors by type, with prompt and model changes marked. Check whether a spike starts at a change",
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
  const points = rate.data.map((row) => ({
    x: bucketLabel(row.bucket),
    rate: num(row.error_rate),
    ...byBucket[bucketLabel(row.bucket)],
  }));
  const errored = Object.values(totals).reduce((sum, value) => sum + value, 0);
  const bars = keys.map((key, index) => ({ key, label: key, colour: COLOURS[index] }));
  const line = { key: "rate", label: "error rate", colour: C.teal };
  return (
    <Panel>
      <Headline value={count(errored)}
        label={"traces with an error, by the step or error type that failed first"} />
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
        <div key={row.step}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 11.5 }}>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
              whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace" }}>{row.step}</span>
            <span style={{ fontSize: 10.5, color: C.faint }}>
              fails {pct(row.failures / row.calls)} of {count(row.calls)} calls
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
      <span><b style={{ color: C.red }}>■</b> reached the user</span>
      <span><b style={{ color: C.orange }}>■</b> recovered: the step above it still succeeded</span>
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
  subtitle: "Fix the step with the most failures that reached the user",
  source: "spans",
  parts: [NUMBERS],
  components: `${FAILURE_ROW}\n\n${FAILURE_ROWS}`,
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const rows = main.data.map(failureRow).filter((row) => row.failures > 0);
  if (rows.length === 0) return <Panel><Note>No step failed in this period.</Note></Panel>;
  return (
    <Panel>
      <div style={{ fontSize: 10.5, color: C.faint, textAlign: "right", marginBottom: 4 }}>
        reached the user
      </div>
      <FailureRows rows={rows} />
      <FailureLegend />
    </Panel>
  );`,
});

export const TOOL_ERROR_RATE_CODE = widgetCode({
  summary: "Error rate per tool, the share of tool errors the agent recovered, and the worst tool.",
  subtitle: "Fix the tool with the highest rate of errors that reached the user",
  source: "spans",
  parts: [NUMBERS, BARS, STAT],
  components: FAILURE_ROW,
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const tools = main.data.map(failureRow);
  const calls = tools.reduce((sum, tool) => sum + tool.calls, 0);
  const failures = tools.reduce((sum, tool) => sum + tool.failures, 0);
  const recovered = tools.reduce((sum, tool) => sum + tool.recovered, 0);
  const ranked = [...tools].sort((a, b) => b.failures / b.calls - a.failures / a.calls);
  const worst = ranked[0];
  const worstLine = failures === 0 ? "No tool failed" : worst.step + " fails " +
    pct(worst.failures / worst.calls) + ", " + count(worst.failures - worst.recovered) +
    " reached the user";
  const bars = ranked.slice(0, 5).map((tool) => ({
    label: tool.step,
    value: tool.failures / tool.calls,
  }));
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        <Stat label={"Tool error rate, " + count(failures) + " of " + count(calls) + " calls"}
          value={pct(calls > 0 ? failures / calls : 0)} />
        <Stat label={"Recovered, of " + count(failures) + " errors"}
          value={failures > 0 ? pct(recovered / failures) : "-"} />
        <Stat label="Worst tool" value={failures > 0 ? worst.step : "none"} />
      </div>
      <div style={{ margin: "8px 0 4px", fontSize: 11, color: C.subtle }}>{worstLine}</div>
      <Bars rows={bars} format={(value) => pct(value)} />
    </Panel>
  );`,
});

export const LOOPS_AND_RETRIES_CODE = widgetCode({
  summary: "Traces that repeat a tool call or retry a failed step, per bucket, and their cost.",
  subtitle: "Cap retries on the step that loops most",
  source: "spans",
  recharts: SERIES_CHART_IMPORTS,
  parts: [NUMBERS, DATES, CHART_STYLE, STAT, SERIES_CHART],
  queries: ["daily", "steps", "totals"],
  body: `  const traffic = num(totals.data[0]?.traces);
  if (traffic === 0) return <Panel><CallToAction /></Panel>;
  if (daily.data.length === 0) {
    return <Panel><Note>No trace looped or retried in this period.</Note></Panel>;
  }
  const points = daily.data.map((row) => ({
    x: bucketLabel(row.bucket),
    looped: num(row.looped_traces),
    retried: num(row.retried_traces),
  }));
  const repeated = points.reduce((sum, point) => sum + point.looped + point.retried, 0);
  const repeatCost = daily.data.reduce((sum, row) => sum + num(row.cost), 0);
  const spend = num(totals.data[0]?.cost);
  const series = [
    { key: "looped", label: "looped: same tool, same input, 3+ times", colour: C.teal,
      bars: true },
    { key: "retried", label: "retried after a failure", colour: C.orange, bars: true },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8,
        marginBottom: 8 }}>
        <Stat label={"Looped or retried, " + pct(repeated / traffic) + " of traces"}
          value={count(repeated)} />
        <Stat label={"Cost of the repeats, " + pct(spend > 0 ? repeatCost / spend : 0) +
          " of spend"} value={usd(repeatCost)} />
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
  subtitle: "Sharpen the tool descriptions when the line rises",
  source: "evaluations",
  recharts: MARKED_CHART_IMPORTS,
  parts: MARKED_PARTS,
  queries: ["trend", "halves", "changes"],
  components: SETUP_NOTE,
  body: `  if (trend.data.length === 0) {
    return (
      <Panel>
        <SetupNote line={'Add an evaluator named "${WRONG_TOOL_JUDGE}" that fails a task whose first tool was wrong.'}>
          <button style={BUTTON} onClick={() => LW.navigate("onlineEvaluations", {})}>
            Add a judge
          </button>
        </SetupNote>
      </Panel>
    );
  }
  const totals = halves.data[0] || {};
  const judged = num(totals.judged);
  const firstJudged = num(totals.judged_first);
  const first = firstJudged > 0 ? num(totals.wrong_first) / firstJudged : 0;
  const secondJudged = judged - firstJudged;
  const second = secondJudged > 0 ? (num(totals.wrong) - num(totals.wrong_first)) / secondJudged : 0;
  const points = trend.data.map((row) => ({ x: bucketLabel(row.bucket), wrong: num(row.wrong_rate) }));
  const label = "wrong first tool, " + count(num(totals.wrong)) + " of " + count(judged) +
    " judged tasks · first half " + pct(first) + ", second half " + pct(second);
  return (
    <Panel>
      <Headline value={pct(judged > 0 ? num(totals.wrong) / judged : 0)} label={label} />
      <MarkedChart points={points} bars={[]} marks={changeMarks(changes.data)}
        line={{ key: "wrong", label: "wrong first tool", colour: C.red }}
        lineFormat={(value) => pct(value)} />
    </Panel>
  );`,
});
