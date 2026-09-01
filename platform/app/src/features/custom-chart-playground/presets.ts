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
 * A real Recharts component, so "+ New widget" proves the compile-and-mount
 * pipeline immediately rather than opening on a blank frame. Static data for
 * now — wiring a widget's `LW.query` calls to its declared queries is the
 * next step.
 */
export const STARTER_WIDGET_CODE = `import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const data = [
  { name: "Mon", value: 12 },
  { name: "Tue", value: 19 },
  { name: "Wed", value: 7 },
  { name: "Thu", value: 24 },
  { name: "Fri", value: 15 },
];

export default function Widget() {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" />
        <YAxis allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="value" fill="#f97316" />
      </BarChart>
    </ResponsiveContainer>
  );
}
`;
