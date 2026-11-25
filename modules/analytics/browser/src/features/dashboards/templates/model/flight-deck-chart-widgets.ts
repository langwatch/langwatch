/**
 * Stored TSX for the Flight Deck's tile and chart panels: Status, Throughput,
 * Quality signal and User feedback. Each draws the matching block view.
 */

import {
  BUCKETS,
  CHART_STYLE,
  COMPLETENESS,
  DATES,
  GAP_BRIDGE,
  NUMBERS,
  THUMBS,
  widgetCode,
  type WidgetSource,
} from "./widget-code-parts.ts";

/** Past tenfold the exact rise says nothing more, as on the legacy summary tiles. */
export const PAST_TENFOLD = `const pastTenfold = (current, previous) => current > previous * 10;`;

/** The Status tiles, with the not-connected face of `source`. */
export const statusCode = ({ source }: { source: WidgetSource }) =>
  widgetCode({
    summary:
      "Request volume, share without an error, response time and total cost against the period " +
      "before.",
    subtitle:
      "Requests, errors, speed and cost for this period, each against the previous period. " +
      "Speed is the time that 1 in 20 requests took longer than.",
    source,
    compactCallToAction: true,
    parts: [NUMBERS, COMPLETENESS],
    components: `${PAST_TENFOLD}
// rising is what a rise means for this figure: "good", "bad" or "neutral".
function Change({ current, previous, rising }) {
  const line = { marginTop: 2, fontSize: 11, fontWeight: 500 };
  if (!known(current)) return null;
  if (!known(previous) || (previous <= 0 && current > 0))
    return <div style={{ ...line, color: C.faint }}>Nothing to compare with yet</div>;
  const delta = previous > 0 ? (current - previous) / previous : 0;
  const up = delta > 0.0005;
  const down = delta < -0.0005;
  let color = C.faint;
  if (rising !== "neutral" && (up || down)) color = up === (rising === "good") ? C.green : C.red;
  let arrow = "→";
  if (up) arrow = "↗";
  if (down) arrow = "↘";
  if (pastTenfold(current, previous)) {
    return (
      <div style={{ ...line, color }}>
        {arrow} more than 10 times the previous period
      </div>
    );
  }
  return (
    <div style={{ ...line, color }}>
      {arrow} {(delta > 0 ? "+" : "") + (delta * 100).toFixed(0) + "%"}
      <span style={{ color: C.faint }}> on the previous period</span>
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
  if (!requests) return <Panel><CallToAction /></Panel>;
  const errorFree = 1 - num(row.errors) / requests;
  const errorFreePrev = requestsPrev > 0 ? 1 - num(row.errors_prev) / requestsPrev : null;
  const columns = "repeat(auto-fit, minmax(140px, 1fr))";
  // Worse than the period before: a point more requests with errors, or a fifth slower.
  const slower = num(row.p95_ms_prev) > 0 && num(row.p95_ms) > num(row.p95_ms_prev) * 1.2;
  signalProblem((known(errorFreePrev) && errorFree < errorFreePrev - 0.01) || slower);
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: columns, gap: 12 }}>
        <Tile label="Requests" value={count(requests)}
          current={requests} previous={requestsPrev} rising="neutral" />
        <Tile label="Without errors" value={pct(errorFree)}
          current={errorFree} previous={errorFreePrev} rising="good" />
        <Tile label="Slowest 1 in 20" value={ms(num(row.p95_ms))}
          current={num(row.p95_ms)} previous={num(row.p95_ms_prev)} rising="bad" />
        <Tile label="Cost" value={costFigure(main, num(row.cost))}
          current={num(row.cost)} previous={num(row.cost_prev)} rising="bad" />
      </div>
    </Panel>
  );`,
  });

export const STATUS_CODE = statusCode({ source: "traces" });

export const THROUGHPUT_CODE = widgetCode({
  summary: "Traces per bucket as bars, response time as a line and the error rate as a low ribbon.",
  subtitle:
    "Shows whether busy times are also slower or fail more. The slow line is the time that 1 " +
    "in 20 requests took longer than.",
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
  parts: [NUMBERS, DATES, CHART_STYLE, BUCKETS, GAP_BRIDGE],
  queries: ["main"],
  body: `  if (main.data.length === 0) return <Panel><CallToAction /></Panel>;
  const rows = withBuckets(main, [{ key: "throughput", kind: "count" }, "p95_ms", "error_rate"]);
  const points = rows.map((row) => ({
    x: bucketLabel(row.bucket), at: bucketStart(row.bucket),
    throughput: num(row.throughput),
    p95: num(row.p95_ms),
    errorRate: num(row.error_rate),
  }));
  const maxRate = Math.max(0.01, ...points.map((point) => point.errorRate ?? 0));
  const formats = { Requests: count, "Slowest 1 in 20": ms, "Share with an error": pct };
  const tip = (value, name) => [known(value) ? formats[name](value) : "No data", name];
  const rose = (key, by) => known(earliest(points, key)) &&
    latest(points, key) > by(earliest(points, key));
  signalProblem(rose("errorRate", (first) => first + 0.01) || rose("p95", (first) => first * 1.2));
  const onDay = (state) => {
    const index = state?.activeTooltipIndex;
    const point = index == null ? undefined : points[Number(index)];
    if (point) askLangy({ kind: "day", label: String(point.x), at: point.at });
  };
  return (
    <Panel>
      <Legend items={[[C.orange, "Requests"], [C.teal, "Slowest 1 in 20"],
        [C.red, "Share with an error"]]} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}
            onClick={canAskLangy() ? onDay : undefined} style={askCursor()}>
            <CartesianGrid vertical={false} stroke={C.border} />
            <XAxis dataKey="x" tick={AXIS} tickLine={false} axisLine={false} minTickGap={28}
              dy={4} />
            <YAxis yAxisId="req" tick={AXIS} tickLine={false} axisLine={false} width={44}
              tickFormatter={count} allowDecimals={false} />
            <YAxis yAxisId="ms" orientation="right" tick={AXIS} tickLine={false}
              axisLine={false} width={48} tickFormatter={ms} />
            <YAxis yAxisId="rate" hide domain={[0, maxRate * 4]} />
            <Tooltip contentStyle={TIP} formatter={tip} filterNull={false} />
            <Area yAxisId="rate" type="monotone" dataKey="errorRate" name="Share with an error"
              stroke={C.red} strokeWidth={1.2} fill={C.red} fillOpacity={0.1}
              isAnimationActive={false} />
            <Bar yAxisId="req" dataKey="throughput" name="Requests" fill={C.orange}
              radius={[2, 2, 0, 0]} isAnimationActive={false} />
            {bridge({ key: "p95", colour: C.teal, yAxisId: "ms" })}
            <Line yAxisId="ms" type="monotone" dataKey="p95" name="Slowest 1 in 20" stroke={C.teal}
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
  subtitle:
    "Share of automatic checks passed over time, next to the share of requests that hit an error.",
  source: "judges",
  recharts: LINE_CHART_IMPORTS,
  parts: [NUMBERS, DATES, CHART_STYLE, BUCKETS, GAP_BRIDGE],
  queries: ["passRate", "errorRate"],
  body: `  if (passRate.data.length === 0) return <Panel><CallToAction /></Panel>;
  const errors = new Map(errorRate.data.map((row) => [row.bucket, num(row.error_rate)]));
  const points = withBuckets(passRate, ["pass_rate"]).map((row) => ({
    x: bucketLabel(row.bucket), at: bucketStart(row.bucket),
    passRate: num(row.pass_rate),
    errorRate: errors.get(row.bucket) ?? null,
  }));
  signalProblem(latest(points, "passRate") < earliest(points, "passRate"));
  return (
    <Panel>
      <Legend items={[[C.teal, "Checks passed"], [C.red, "Requests with an error", true]]} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={C.border} />
            <XAxis dataKey="x" tick={AXIS} tickLine={false} axisLine={false} minTickGap={28}
              dy={4} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={40} domain={[0, 1]}
              tickFormatter={(value) => pct(value, 0)} />
            <Tooltip contentStyle={TIP} formatter={tipValue(pct)} filterNull={false} />
            {bridge({ key: "passRate", colour: C.teal })}
            {bridge({ key: "errorRate", colour: C.red })}
            <Line type="monotone" dataKey="passRate" name="Checks passed" stroke={C.teal}
              strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="errorRate" name="Requests with an error" stroke={C.red}
              strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );`,
});

export const FEEDBACK_CODE = widgetCode({
  summary: "Thumbs up and down in the period, then the share of positive feedback over time.",
  subtitle: "Thumbs from people on your team reviewing answers in LangWatch.",
  source: "feedback",
  recharts: LINE_CHART_IMPORTS,
  parts: [NUMBERS, DATES, CHART_STYLE, THUMBS, BUCKETS, GAP_BRIDGE],
  queries: ["summary", "rate"],
  body: `  const up = num(summary.data[0]?.thumbs_up);
  const down = num(summary.data[0]?.thumbs_down);
  if (!add(up, down)) return <Panel><CallToAction /></Panel>;
  const points = withBuckets(rate, ["positive_rate"]).map((row) => ({
    x: bucketLabel(row.bucket), at: bucketStart(row.bucket),
    positive: num(row.positive_rate),
  }));
  signalProblem(latest(points, "positive") < earliest(points, "positive"));
  const tally = (color) => ({ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color });
  return (
    <Panel>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
        <span style={{ fontSize: 22, fontWeight: 600 }}>{pct(up / (up + down), 0)}</span>
        <span style={{ fontSize: 11, color: C.subtle }}>of reviewer votes were thumbs up</span>
        <span style={tally(C.green)}><Thumb up color={C.green} /> {count(up)}</span>
        <span style={tally(C.red)}><Thumb color={C.red} /> {count(down)}</span>
      </div>
      <Legend items={[[C.pink, "Thumbs up share", true]]} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={C.border} />
            <XAxis dataKey="x" tick={AXIS} tickLine={false} axisLine={false} minTickGap={28}
              dy={4} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={40} domain={[0, 1]}
              tickFormatter={(value) => pct(value, 0)} />
            <Tooltip contentStyle={TIP} formatter={tipValue((value) => pct(value, 0))}
              filterNull={false} />
            {bridge({ key: "positive", colour: C.pink })}
            <Line type="monotone" dataKey="positive" name="Thumbs up share" stroke={C.pink}
              strokeWidth={1.8} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );`,
});
