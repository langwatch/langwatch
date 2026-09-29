/**
 * Stored TSX for the Flight Deck's tile and chart panels: Status, Throughput,
 * Quality signal and User feedback. Each draws the matching block view.
 */

import {
  CHART_STYLE,
  DATES,
  NUMBERS,
  THUMBS,
  widgetCode,
  type WidgetSource,
} from "./widget-code-parts.ts";

/** The Status tiles, with the not-connected face of `source`. */
export const statusCode = ({ source }: { source: WidgetSource }) =>
  widgetCode({
    summary: "Request volume, success rate, p95 latency and total cost against the period before.",
    subtitle: "Traffic, quality, latency and cost at a glance",
    source,
    compactCallToAction: true,
    parts: [NUMBERS],
    components: `// rising is what a rise means for this figure: "good", "bad" or "neutral".
function Change({ current, previous, rising }) {
  const line = { marginTop: 2, fontSize: 11, fontWeight: 500 };
  if (previous <= 0 && current > 0)
    return <div style={{ ...line, color: C.faint }}>No earlier data</div>;
  const delta = previous > 0 ? (current - previous) / previous : 0;
  const up = delta > 0.0005;
  const down = delta < -0.0005;
  let color = C.faint;
  if (rising !== "neutral" && (up || down)) color = up === (rising === "good") ? C.green : C.red;
  let arrow = "→";
  if (up) arrow = "↗";
  if (down) arrow = "↘";
  return (
    <div style={{ ...line, color }}>
      {arrow} {(delta > 0 ? "+" : "") + (delta * 100).toFixed(0) + "%"}
      <span style={{ color: C.faint }}> vs prev</span>
    </div>
  );
}

function Tile({ label, value, current, previous, rising }) {
  return (
    <div style={{ border: "1px solid " + C.border, borderRadius: 8, padding: "10px 12px",
      background: C.muted + "66" }}>
      <div style={{ fontSize: 11, fontWeight: 500, color: C.subtle }}>{label}</div>
      <div style={{ marginTop: 2, fontSize: 20, lineHeight: "24px", fontWeight: 600,
        letterSpacing: "-0.025em" }}>{value}</div>
      <Change current={current} previous={previous} rising={rising} />
    </div>
  );
}`,
    queries: ["main"],
    body: `  const row = main.data[0] || {};
  const requests = num(row.requests);
  const requestsPrev = num(row.requests_prev);
  if (requests === 0) return <Panel><CallToAction /></Panel>;
  const success = 1 - num(row.errors) / requests;
  const successPrev = requestsPrev > 0 ? 1 - num(row.errors_prev) / requestsPrev : 0;
  const columns = "repeat(auto-fit, minmax(140px, 1fr))";
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: columns, gap: 12 }}>
        <Tile label="Request volume" value={count(requests)}
          current={requests} previous={requestsPrev} rising="neutral" />
        <Tile label="Success rate" value={pct(success)}
          current={success} previous={successPrev} rising="good" />
        <Tile label="p95 latency" value={ms(num(row.p95_ms))}
          current={num(row.p95_ms)} previous={num(row.p95_ms_prev)} rising="bad" />
        <Tile label="Total cost" value={usd(num(row.cost))}
          current={num(row.cost)} previous={num(row.cost_prev)} rising="bad" />
      </div>
    </Panel>
  );`,
  });

export const STATUS_CODE = statusCode({ source: "traces" });

export const THROUGHPUT_CODE = widgetCode({
  summary: "Traces per bucket as bars, p95 latency as a line and the error rate as a low ribbon.",
  subtitle: "Correlate traffic spikes with degradation",
  source: "traces",
  recharts: [
    "ResponsiveContainer",
    "ComposedChart",
    "CartesianGrid",
    "XAxis",
    "YAxis",
    "Tooltip",
    "Area",
    "Bar",
    "Line",
  ],
  parts: [NUMBERS, DATES, CHART_STYLE],
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const points = main.data.map((row) => ({
    x: bucketLabel(row.bucket),
    throughput: num(row.throughput),
    p95: num(row.p95_ms),
    errorRate: num(row.error_rate),
  }));
  const maxRate = Math.max(0.01, ...points.map((point) => point.errorRate));
  const formats = { throughput: count, "p95 latency": ms, "error rate": pct };
  return (
    <Panel>
      <Legend items={[[C.orange, "throughput"], [C.teal, "p95 latency"], [C.red, "error rate"]]} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={C.border} />
            <XAxis dataKey="x" tick={AXIS} tickLine={false} axisLine={false} minTickGap={28}
              dy={4} />
            <YAxis yAxisId="req" tick={AXIS} tickLine={false} axisLine={false} width={44}
              tickFormatter={count} />
            <YAxis yAxisId="ms" orientation="right" tick={AXIS} tickLine={false}
              axisLine={false} width={48} tickFormatter={ms} />
            <YAxis yAxisId="rate" hide domain={[0, maxRate * 4]} />
            <Tooltip contentStyle={TIP} formatter={(value, name) => [formats[name](value), name]} />
            <Area yAxisId="rate" type="monotone" dataKey="errorRate" name="error rate"
              stroke={C.red} strokeWidth={1.2} fill={C.red} fillOpacity={0.1}
              isAnimationActive={false} />
            <Bar yAxisId="req" dataKey="throughput" name="throughput" fill={C.orange}
              radius={[2, 2, 0, 0]} isAnimationActive={false} />
            <Line yAxisId="ms" type="monotone" dataKey="p95" name="p95 latency" stroke={C.teal}
              strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );`,
});

const LINE_CHART_IMPORTS = [
  "ResponsiveContainer",
  "ComposedChart",
  "CartesianGrid",
  "XAxis",
  "YAxis",
  "Tooltip",
  "Line",
] as const;

export const QUALITY_CODE = widgetCode({
  summary: "Evaluator pass rate over time, drawn against the trace error rate of the same buckets.",
  subtitle: "Evaluator pass rate over time, against the error rate",
  source: "judges",
  recharts: LINE_CHART_IMPORTS,
  parts: [NUMBERS, DATES, CHART_STYLE],
  queries: ["passRate", "errorRate"],
  body: `  if (passRate.data.length === 0) return <Panel><CallToAction /></Panel>;
  const errors = new Map(errorRate.data.map((row) => [row.bucket, num(row.error_rate)]));
  const points = passRate.data.map((row) => ({
    x: bucketLabel(row.bucket),
    passRate: num(row.pass_rate),
    errorRate: errors.get(row.bucket) || 0,
  }));
  return (
    <Panel>
      <Legend items={[[C.teal, "evaluator pass rate"], [C.red, "error rate", true]]} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={C.border} />
            <XAxis dataKey="x" tick={AXIS} tickLine={false} axisLine={false} minTickGap={28}
              dy={4} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={40} domain={[0, 1]}
              tickFormatter={(value) => pct(value, 0)} />
            <Tooltip contentStyle={TIP} formatter={(value, name) => [pct(value), name]} />
            <Line type="monotone" dataKey="passRate" name="pass rate" stroke={C.teal}
              strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="errorRate" name="error rate" stroke={C.red}
              strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );`,
});

export const FEEDBACK_CODE = widgetCode({
  summary: "Thumbs up and down in the period, then the share of positive feedback over time.",
  subtitle: "What users think of the answers",
  source: "feedback",
  recharts: LINE_CHART_IMPORTS,
  parts: [NUMBERS, DATES, CHART_STYLE, THUMBS],
  queries: ["summary", "rate"],
  body: `  const up = num(summary.data[0]?.thumbs_up);
  const down = num(summary.data[0]?.thumbs_down);
  if (up + down === 0) return <Panel><CallToAction /></Panel>;
  const points = rate.data.map((row) => ({
    x: bucketLabel(row.bucket),
    positive: num(row.positive_rate),
  }));
  const tally = (color) => ({ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color });
  return (
    <Panel>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
        <span style={{ fontSize: 22, fontWeight: 600 }}>{pct(up / (up + down), 0)}</span>
        <span style={tally(C.green)}><Thumb up color={C.green} /> {count(up)}</span>
        <span style={tally(C.red)}><Thumb color={C.red} /> {count(down)}</span>
      </div>
      <Legend items={[[C.pink, "positive feedback rate", true]]} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={C.border} />
            <XAxis dataKey="x" tick={AXIS} tickLine={false} axisLine={false} minTickGap={28}
              dy={4} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={40} domain={[0, 1]}
              tickFormatter={(value) => pct(value, 0)} />
            <Tooltip contentStyle={TIP} formatter={(value) => [pct(value, 0), "positive"]} />
            <Line type="monotone" dataKey="positive" name="positive feedback" stroke={C.pink}
              strokeWidth={1.8} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );`,
});
