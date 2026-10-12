/**
 * The author-code side of the nine Analytics v2 widgets: the shared render
 * shell and each widget's own recharts source string.
 *
 * Split out of `widgets.ts` so each file stays under the source-line budget.
 * `widgets.ts` imports the nine `*Code` strings from here and pairs each with
 * its SQL in a `DashboardWidgetDefinition`. `ANALYTICS_V2_EMPTY_STATE_TEXT`
 * lives here because the shared state guards embed it; `widgets.ts` re-exports
 * it for the page and the tests.
 */

/** Rendered by every widget's code when its query returns zero rows. */
export const ANALYTICS_V2_EMPTY_STATE_TEXT = "No data in this period.";

/**
 * The state-guard block every widget shares: an error renders its message, a
 * loading/unresolved query renders "Loading…", and a resolved-but-empty
 * result renders the one empty-state text. The chart never runs on a null or
 * empty `data`, so a zero-row period is an empty state rather than a thrown
 * error.
 */
const STATE_GUARDS = `  if (isError) {
    return <div style={{ fontSize: 11, color: "#b00" }}>{error.message}</div>;
  }
  if (isLoading || data === null) {
    return <div style={{ fontSize: 11, color: "#666" }}>Loading…</div>;
  }
  if (data.length === 0) {
    return <div style={{ fontSize: 11, color: "#666" }}>${ANALYTICS_V2_EMPTY_STATE_TEXT}</div>;
  }`;

/**
 * Assemble one widget's source: the recharts import line, the standard
 * `LW.useChartQuery("main")` read, the shared state guards, the widget's own
 * row mapping, and its bare chart element wrapped in the shared responsive
 * container shell every chart renders inside. Each widget supplies only what
 * differs — its `imports`, its `rows` mapping, and its `chart` element.
 */
function widgetCode({
  imports,
  rows,
  chart,
}: {
  imports: string;
  rows: string;
  chart: string;
}): string {
  return `import { ${imports} } from "recharts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});

${STATE_GUARDS}

${rows}

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
${chart}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
`;
}

export const traceCountCode = widgetCode({
  imports:
    "ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip",
  rows: `  const rows = data.map(function (row) {
    return { bucket: String(row.bucket).slice(0, 10), traces: Number(row.traces) };
  });`,
  chart: `          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Line type="monotone" dataKey="traces" stroke="#f97316" dot={false} />
          </LineChart>`,
});

export const totalCostCode = widgetCode({
  imports:
    "ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip",
  rows: `  const rows = data.map(function (row) {
    return { bucket: String(row.bucket).slice(0, 10), cost: Number(row.cost || 0) };
  });`,
  chart: `          <AreaChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
            <YAxis unit="$" />
            <Tooltip formatter={function (value) { return "$" + Number(value).toFixed(2); }} />
            <Area type="monotone" dataKey="cost" stroke="#22c55e" fill="#22c55e" fillOpacity={0.3} />
          </AreaChart>`,
});

export const tokensCode = widgetCode({
  imports:
    "ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, Legend",
  rows: `  const rows = data.map(function (row) {
    return {
      bucket: String(row.bucket).slice(0, 10),
      prompt_tokens: Number(row.prompt_tokens || 0),
      completion_tokens: Number(row.completion_tokens || 0),
    };
  });`,
  chart: `          <AreaChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Area type="monotone" dataKey="prompt_tokens" stackId="tokens" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.4} />
            <Area type="monotone" dataKey="completion_tokens" stackId="tokens" stroke="#f97316" fill="#f97316" fillOpacity={0.4} />
          </AreaChart>`,
});

export const latencyCode = widgetCode({
  imports:
    "ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend",
  rows: `  const rows = data.map(function (row) {
    return {
      bucket: String(row.bucket).slice(0, 10),
      p50: Number(row.p50),
      p90: Number(row.p90),
      p99: Number(row.p99),
    };
  });`,
  chart: `          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
            <YAxis unit="ms" />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="p50" stroke="#22c55e" dot={false} />
            <Line type="monotone" dataKey="p90" stroke="#f59e0b" dot={false} />
            <Line type="monotone" dataKey="p99" stroke="#ef4444" dot={false} />
          </LineChart>`,
});

export const satisfactionCode = widgetCode({
  imports:
    "ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip",
  rows: `  const rows = data.map(function (row) {
    return {
      bucket: String(row.bucket).slice(0, 10),
      satisfaction: Math.round(Number(row.satisfaction || 0) * 100) / 100,
    };
  });`,
  chart: `          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="satisfaction" stroke="#ec4899" dot={false} />
          </LineChart>`,
});

export const evaluationPassRateCode = widgetCode({
  imports:
    "ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip",
  rows: `  const rows = data.map(function (row) {
    const scored = Number(row.scored || 0);
    const passed = Number(row.passed || 0);
    return {
      bucket: String(row.bucket).slice(0, 10),
      pass_rate: scored > 0 ? Math.round((passed / scored) * 1000) / 10 : null,
    };
  });`,
  chart: `          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
            <YAxis unit="%" domain={[0, 100]} />
            <Tooltip formatter={function (value) { return value + "%"; }} />
            <Line type="monotone" dataKey="pass_rate" stroke="#8b5cf6" dot={false} connectNulls />
          </LineChart>`,
});

export const avgTracesPerThreadCode = widgetCode({
  imports:
    "ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip",
  rows: `  const rows = data.map(function (row) {
    return {
      bucket: String(row.day).slice(0, 10),
      avg_traces: Math.round(Number(row.avg_traces_per_thread || 0) * 100) / 100,
    };
  });`,
  chart: `          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="avg_traces" stroke="#14b8a6" dot={false} />
          </LineChart>`,
});

export const topModelsCode = widgetCode({
  imports:
    "ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip",
  rows: `  const rows = data
    .map(function (row) {
      return { model: String(row.model), traces: Number(row.traces) };
    })
    .reverse();`,
  chart: `          <BarChart data={rows} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" allowDecimals={false} />
            <YAxis type="category" dataKey="model" tick={{ fontSize: 10 }} width={140} />
            <Tooltip />
            <Bar dataKey="traces" fill="#f97316" />
          </BarChart>`,
});

export const topTopicsCode = widgetCode({
  imports:
    "ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip",
  rows: `  const rows = data
    .map(function (row) {
      return { topic: String(row.topic), traces: Number(row.traces) };
    })
    .reverse();`,
  chart: `          <BarChart data={rows} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" allowDecimals={false} />
            <YAxis type="category" dataKey="topic" tick={{ fontSize: 10 }} width={140} />
            <Tooltip />
            <Bar dataKey="traces" fill="#f97316" />
          </BarChart>`,
});
