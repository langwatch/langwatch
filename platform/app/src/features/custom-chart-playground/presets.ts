/**
 * What a freshly-created playground widget starts with: a LangWatchQL
 * statement (the SQL pane) and a React/TSX file (the Code pane) that the
 * sandboxed frame compiles and mounts. SQL never travels from the frame —
 * these are the two halves the persisted `CustomGraph.graph` stores together.
 */

/** Bucketed trace counts — the canonical follows-everything statement. */
export const STARTER_WIDGET_SQL = `SELECT toStartOfInterval(OccurredAt, INTERVAL {period_granularity_seconds:UInt32} SECOND) AS bucket,
  count() AS events
FROM traces
WHERE OccurredAt >= {period_start:DateTime} AND OccurredAt < {period_end:DateTime}
GROUP BY bucket
ORDER BY bucket`;

/**
 * A real Recharts component, so "+ New widget" proves the compile-and-mount
 * pipeline immediately rather than opening on a blank frame. Static data for
 * now — wiring this up to `LW.query` is the next step, once a widget can
 * declare the named queries it runs.
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
