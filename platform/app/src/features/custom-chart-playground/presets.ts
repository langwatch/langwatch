/**
 * What a freshly-created playground widget starts with: a React/TSX file
 * (the Code pane) and the named LangWatchQL statements it may run. Neither
 * SQL travels from the frame — these are the pieces the persisted
 * `CustomGraph.graph` stores together, in the shape
 * `PlaygroundWidgetDefinition` (`~/server/analytics/playgroundWidgetDefinition`)
 * describes.
 */

import type { PlaygroundQuery } from "~/server/analytics/playgroundWidgetDefinition";

/** Bucketed trace counts — the canonical follows-everything statement. */
const BUCKETED_TRACES_SQL = `SELECT toStartOfInterval(OccurredAt, INTERVAL {period_granularity_seconds:UInt32} SECOND) AS bucket,
  count() AS events
FROM traces
WHERE OccurredAt >= {period_start:DateTime} AND OccurredAt < {period_end:DateTime}
GROUP BY bucket
ORDER BY bucket`;

/**
 * The query a freshly-created widget starts with, named "main" so a widget
 * that goes on to call `LW.query("main", {})` finds it without renaming
 * anything. No declared parameters: the statement only uses the reserved
 * window/granularity placeholders, which the executor supplies regardless of
 * what a query declares.
 */
export const STARTER_WIDGET_QUERIES: PlaygroundQuery[] = [
  { name: "main", sql: BUCKETED_TRACES_SQL },
];

/**
 * A real Recharts component wired to the widget's own "main" query, so
 * "+ New widget" proves the whole pipeline immediately: compile-and-mount,
 * `LW.useChartQuery(name, params)` dispatch, parent-side validation (this
 * call passes no params, matching "main"'s zero declared parameters), and a
 * real ClickHouse round trip rendering as a bar chart that fills its card.
 */
export const STARTER_WIDGET_CODE = `import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function Widget() {
  const { data, loading, error } = LW.useChartQuery("main", {});

  const status = error
    ? error
    : loading
      ? "Loading..."
      : data.length + " rows";

  const rows = (data || []).map(function (row) {
    return { bucket: String(row.bucket).slice(5, 16), events: Number(row.events) };
  });

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: "11px", color: "#666", marginBottom: 4, flexShrink: 0 }}>{status}</div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="events" fill="#f97316" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
`;
