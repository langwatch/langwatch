/**
 * Helper snippets the Flight Deck cockpit and Running costs widgets share, on top of
 * `widget-code-parts.ts`: figures against the period before, a chart with change markers,
 * links to the traces behind a number, and the setup step for conversation outcomes.
 */

import { OUTCOME_JUDGE } from "./flight-deck-costs-queries.ts";

/** The Recharts components `MARKED_CHART` draws with. */
export const MARKED_CHART_IMPORTS = [
  "ResponsiveContainer",
  "ComposedChart",
  "CartesianGrid",
  "XAxis",
  "YAxis",
  "Tooltip",
  "ReferenceLine",
  "Bar",
  "Line",
] as const;

/** Figure tiles with their change against the period before; reads `NUMBERS`. */
export const FIGURES = `const signedPct = (value) => (value > 0 ? "+" : "") + pct(value, 0);

// better is the direction that is good for this figure: "up" or "down".
function Change({ now, before, better, format }) {
  const line = { marginTop: 2, fontSize: 11, fontWeight: 500 };
  if (!(before > 0)) return <div style={{ ...line, color: C.faint }}>No earlier data</div>;
  const delta = (now - before) / before;
  const flat = Math.abs(delta) < 0.005;
  let color = C.faint;
  if (!flat) color = (delta > 0) === (better === "up") ? C.green : C.red;
  let arrow = "→";
  if (!flat) arrow = delta > 0 ? "↗" : "↘";
  return (
    <div style={{ ...line, color }}>
      {arrow} {signedPct(delta)}<span style={{ color: C.faint }}> from {format(before)}</span>
    </div>
  );
}

function Figure({ label, value, children }) {
  return (
    <div style={{ border: "1px solid " + C.border, borderRadius: 8, padding: "10px 12px",
      background: C.muted + "66", minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 500, color: C.subtle }}>{label}</div>
      <div style={{ marginTop: 2, fontSize: 20, lineHeight: "24px", fontWeight: 600,
        letterSpacing: "-0.025em" }}>{value}</div>
      {children}
    </div>
  );
}

function Figures({ children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
      gap: 12 }}>
      {children}
    </div>
  );
}

function Hint({ children, onClick }) {
  const link = onClick ? { cursor: "pointer", textDecoration: "underline" } : {};
  return (
    <div onClick={onClick} style={{ marginTop: 2, fontSize: 11, color: C.faint, ...link }}>
      {children}
    </div>
  );
}`;

/** A share that is zero, not NaN, when the whole is zero. */
export const RATIO = `const ratio = (part, whole) => (whole > 0 ? part / whole : 0);`;

/** The trace explorer over the board's period, filtered by trace search fields. */
export const TRACES_LINK = `function openTraces(filter = {}) {
  const { start, end } = LW.dashboardContext.timeWindow;
  LW.navigate("traces", { ...filter, startDate: start, endDate: end });
}`;

/** "capability_gap" as "Capability gap". */
export const WORDS = `function words(text) {
  const spaced = String(text || "").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}`;

/**
 * An empty face that runs the widget's "seen" query only once its own rows are empty: data in
 * the last 90 days means a quiet period, none means the setup step and its action.
 */
export const SEEN_OR_SETUP = `function SeenOrSetup({ quiet, action, onAction, children }) {
  const seen = LW.useChartQuery("seen", {});
  if (seen.isError) return <Note color={C.red}>{seen.error.message}</Note>;
  if (!seen.data) return <Note>Loading</Note>;
  if (seen.data.length > 0) return <Note>{quiet}</Note>;
  return (
    <Note>
      <span style={{ maxWidth: 340, textAlign: "center" }}>{children}</span>
      <span onClick={onAction} style={{ marginTop: 6, color: C.teal, cursor: "pointer" }}>
        {action}
      </span>
    </Note>
  );
}`;

/** The empty face of a widget that counts conversation outcomes; reads `SEEN_OR_SETUP`. */
export const OUTCOME_EMPTY = `function OutcomeEmpty({ quiet }) {
  return (
    <SeenOrSetup quiet={quiet} action="Add a judge"
      onAction={() => LW.navigate("onlineEvaluations", {})}>
      No conversation outcomes yet. Add the ${OUTCOME_JUDGE}, or send "outcome" in the metadata
      of each conversation's last trace.
    </SeenOrSetup>
  );
}`;

/** One point per bucket from rows of bucket, key and value; reads `DATES`. */
export const PIVOT = `function pivot(rows, key, value) {
  const byBucket = new Map();
  for (const row of rows) {
    const point = byBucket.get(row.bucket) || { x: bucketLabel(row.bucket) };
    point[row[key]] = value(row);
    byBucket.set(row.bucket, point);
  }
  return [...byBucket.values()];
}`;

/** A time series of bars and lines with change markers; reads `CHART_STYLE`. */
export const MARKED_CHART = `// series: { key, label, colour, dashed?, bars?, stack?, right? }; markers: { x, label }.
function MarkedChart({ points, series, format, rightFormat, markers = [], domain }) {
  const right = series.some((item) => item.right);
  const shown = markers.filter((marker) => points.some((point) => point.x === marker.x));
  const formatOf = (name) => (series.find((item) => item.label === name)?.right ? rightFormat : format);
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Legend items={series.map((item) => [item.colour, item.label, item.dashed])} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 14, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={C.border} />
            <XAxis dataKey="x" tick={AXIS} tickLine={false} axisLine={false} minTickGap={28}
              dy={4} />
            <YAxis yAxisId="left" tick={AXIS} tickLine={false} axisLine={false} width={48}
              domain={domain} tickFormatter={format} />
            {right && (
              <YAxis yAxisId="right" orientation="right" tick={AXIS} tickLine={false}
                axisLine={false} width={40} domain={[0, 1]} tickFormatter={rightFormat} />
            )}
            <Tooltip contentStyle={TIP} formatter={(value, name) => [formatOf(name)(value), name]} />
            {shown.map((marker) => (
              <ReferenceLine key={marker.x + marker.label} yAxisId="left" x={marker.x}
                stroke={C.faint} strokeDasharray="3 3"
                label={{ value: marker.label, position: "top", fontSize: 10, fill: C.faint }} />
            ))}
            {series.map((item) => item.bars ? (
              <Bar key={item.key} yAxisId={item.right ? "right" : "left"} dataKey={item.key}
                name={item.label} fill={item.colour} stackId={item.stack}
                isAnimationActive={false} />
            ) : (
              <Line key={item.key} yAxisId={item.right ? "right" : "left"} type="monotone"
                dataKey={item.key} name={item.label} stroke={item.colour} strokeWidth={2}
                strokeDasharray={item.dashed ? "4 3" : undefined} dot={false} connectNulls
                isAnimationActive={false} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// A model or prompt version first seen in the period, as a marker on its bucket.
const markerOf = (row) => ({
  x: bucketLabel(row.bucket),
  label: row.kind === "prompt" ? "prompt " + row.name : row.name,
});`;
