/**
 * What a freshly-created dashboard widget starts with: a React/TSX file
 * and the named LangWatchQL statements it may run — the pieces
 * `CustomGraph.graph` persists as a `DashboardWidgetDefinition`.
 */

import type { DashboardWidgetQuery } from "../dashboardWidgetDefinition.ts";

/** Bucketed trace counts — the canonical follows-everything statement. */
const BUCKETED_TRACES_SQL = `SELECT toStartOfInterval(OccurredAt, INTERVAL {dashboard_context_granularity_seconds:UInt32} SECOND) AS bucket,
  count() AS events
FROM traces
WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime}
GROUP BY bucket
ORDER BY bucket`;

/**
 * The starter widget's query, named "main" so `LW.query("main", {})`
 * finds it unrenamed. No declared parameters: it only uses the reserved
 * window/granularity placeholders the executor always supplies.
 */
export const STARTER_WIDGET_QUERIES: DashboardWidgetQuery[] = [
  { name: "main", sql: BUCKETED_TRACES_SQL },
];

/**
 * A real Recharts component wired to "main", so "+ New widget" proves the
 * whole pipeline at once: compile-and-mount, `LW.useChartQuery` dispatch,
 * parameter validation, and a real ClickHouse round trip rendering a chart.
 */
export const STARTER_WIDGET_CODE = `import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});

  const status = isError
    ? error.message
    : isLoading
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
          <BarChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="bucket" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} axisLine={false} tickLine={false} width={48} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="events" fill="#f97316" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
`;
