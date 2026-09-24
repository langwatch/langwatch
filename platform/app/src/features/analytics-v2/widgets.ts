/**
 * The nine Analytics v2 widget definitions — inline, never persisted.
 *
 * The Analytics v2 page stores nothing: it hands each of these definitions
 * straight to the same sandboxed `DashboardWidgetFrame` a saved dashboard
 * uses, and the frame renders whatever definition it is given. There is no
 * `CustomGraph` row behind these, so the source of truth is this module —
 * keeping the definitions inline means the page has no seed step, no
 * migration, and no drift between "what the page shows" and "what a project
 * happens to have saved".
 *
 * Each definition is a valid `DashboardWidgetDefinition` (version 1). Every
 * query reads only the reserved `{dashboard_context_period_*}` placeholders,
 * which the executor binds from the page's own period control — no
 * author-declared parameters. The eight time-series/leaderboard queries are
 * ports of the legacy `/analytics` charts onto LangWatchQL catalog views; the
 * ninth (Top topics) resolves topic names through the `topics` catalog view,
 * falling back to the raw topic id when a name is missing.
 */

import type { DashboardWidgetDefinition } from "~/server/analytics/dashboardWidgetDefinition";

/** Rendered by every widget's code when its query returns zero rows. */
export const ANALYTICS_V2_EMPTY_STATE_TEXT = "No data in this period.";

export const ANALYTICS_V2_WIDGET_IDS = [
  "trace-count-over-time",
  "total-cost-over-time",
  "tokens-over-time",
  "latency-percentiles",
  "satisfaction-over-time",
  "evaluation-pass-rate",
  "average-traces-per-thread",
  "top-models",
  "top-topics",
] as const;

export type AnalyticsV2WidgetId = (typeof ANALYTICS_V2_WIDGET_IDS)[number];

export type AnalyticsV2Widget = {
  id: AnalyticsV2WidgetId;
  title: string;
  definition: DashboardWidgetDefinition;
};

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
 * `LW.useChartQuery("main")` read, the shared state guards, then the widget's
 * own row mapping and chart body.
 */
function widgetCode({ imports, body }: { imports: string; body: string }): string {
  return `import { ${imports} } from "recharts";

export default function Widget() {
  const { data, isLoading, isError, error } = LW.useChartQuery("main", {});

${STATE_GUARDS}

${body}
}
`;
}

const traceCountCode = widgetCode({
  imports:
    "ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip",
  body: `  const rows = data.map(function (row) {
    return { bucket: String(row.bucket).slice(0, 10), traces: Number(row.traces) };
  });

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Line type="monotone" dataKey="traces" stroke="#f97316" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );`,
});

const totalCostCode = widgetCode({
  imports: "ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip",
  body: `  const rows = data.map(function (row) {
    return { bucket: String(row.bucket).slice(0, 10), cost: Number(row.cost || 0) };
  });

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
            <YAxis unit="$" />
            <Tooltip formatter={function (value) { return "$" + Number(value).toFixed(2); }} />
            <Area type="monotone" dataKey="cost" stroke="#22c55e" fill="#22c55e" fillOpacity={0.3} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );`,
});

const tokensCode = widgetCode({
  imports:
    "ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, Legend",
  body: `  const rows = data.map(function (row) {
    return {
      bucket: String(row.bucket).slice(0, 10),
      prompt_tokens: Number(row.prompt_tokens || 0),
      completion_tokens: Number(row.completion_tokens || 0),
    };
  });

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Area type="monotone" dataKey="prompt_tokens" stackId="tokens" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.4} />
            <Area type="monotone" dataKey="completion_tokens" stackId="tokens" stroke="#f97316" fill="#f97316" fillOpacity={0.4} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );`,
});

const latencyCode = widgetCode({
  imports:
    "ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend",
  body: `  const rows = data.map(function (row) {
    return {
      bucket: String(row.bucket).slice(0, 10),
      p50: Number(row.p50),
      p90: Number(row.p90),
      p99: Number(row.p99),
    };
  });

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
            <YAxis unit="ms" />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="p50" stroke="#22c55e" dot={false} />
            <Line type="monotone" dataKey="p90" stroke="#f59e0b" dot={false} />
            <Line type="monotone" dataKey="p99" stroke="#ef4444" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );`,
});

const satisfactionCode = widgetCode({
  imports:
    "ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip",
  body: `  const rows = data.map(function (row) {
    return {
      bucket: String(row.bucket).slice(0, 10),
      satisfaction: Math.round(Number(row.satisfaction || 0) * 100) / 100,
    };
  });

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="satisfaction" stroke="#ec4899" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );`,
});

const evaluationPassRateCode = widgetCode({
  imports:
    "ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip",
  body: `  const rows = data.map(function (row) {
    const scored = Number(row.scored || 0);
    const passed = Number(row.passed || 0);
    return {
      bucket: String(row.bucket).slice(0, 10),
      pass_rate: scored > 0 ? Math.round((passed / scored) * 1000) / 10 : null,
    };
  });

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
            <YAxis unit="%" domain={[0, 100]} />
            <Tooltip formatter={function (value) { return value + "%"; }} />
            <Line type="monotone" dataKey="pass_rate" stroke="#8b5cf6" dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );`,
});

const avgTracesPerThreadCode = widgetCode({
  imports:
    "ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip",
  body: `  const rows = data.map(function (row) {
    return {
      bucket: String(row.day).slice(0, 10),
      avg_traces: Math.round(Number(row.avg_traces_per_thread || 0) * 100) / 100,
    };
  });

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="avg_traces" stroke="#14b8a6" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );`,
});

const topModelsCode = widgetCode({
  imports: "ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip",
  body: `  const rows = data
    .map(function (row) {
      return { model: String(row.model), traces: Number(row.traces) };
    })
    .slice()
    .reverse();

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" allowDecimals={false} />
            <YAxis type="category" dataKey="model" tick={{ fontSize: 10 }} width={140} />
            <Tooltip />
            <Bar dataKey="traces" fill="#f97316" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );`,
});

const topTopicsCode = widgetCode({
  imports: "ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip",
  body: `  const rows = data
    .map(function (row) {
      return { topic: String(row.topic), traces: Number(row.traces) };
    })
    .slice()
    .reverse();

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" allowDecimals={false} />
            <YAxis type="category" dataKey="topic" tick={{ fontSize: 10 }} width={140} />
            <Tooltip />
            <Bar dataKey="traces" fill="#f97316" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );`,
});

/** Build a single-query, version-1 definition with the reserved-period contract. */
function definition(code: string, sql: string): DashboardWidgetDefinition {
  return { version: 1, code, queries: [{ name: "main", sql, parameters: [] }] };
}

export const ANALYTICS_V2_WIDGETS: readonly AnalyticsV2Widget[] = [
  {
    id: "trace-count-over-time",
    title: "Trace count over time",
    definition: definition(
      traceCountCode,
      `SELECT toStartOfDay(OccurredAt) AS bucket, uniqExact(TraceId) AS traces
FROM trace_metrics
WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime}
  AND TotalDurationMs > 0
GROUP BY bucket
ORDER BY bucket`,
    ),
  },
  {
    id: "total-cost-over-time",
    title: "Total cost over time",
    definition: definition(
      totalCostCode,
      `SELECT toStartOfDay(OccurredAt) AS bucket, sum(TotalCost) AS cost
FROM trace_metrics
WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime}
  AND TotalDurationMs > 0
GROUP BY bucket
ORDER BY bucket`,
    ),
  },
  {
    id: "tokens-over-time",
    title: "Tokens over time",
    definition: definition(
      tokensCode,
      `SELECT toStartOfDay(OccurredAt) AS bucket,
  sum(PromptTokens) AS prompt_tokens,
  sum(CompletionTokens) AS completion_tokens
FROM trace_metrics
WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime}
  AND TotalDurationMs > 0
GROUP BY bucket
ORDER BY bucket`,
    ),
  },
  {
    id: "latency-percentiles",
    title: "Latency percentiles",
    definition: definition(
      latencyCode,
      `SELECT toStartOfDay(OccurredAt) AS bucket,
  quantile(0.5)(TotalDurationMs) AS p50,
  quantile(0.9)(TotalDurationMs) AS p90,
  quantile(0.99)(TotalDurationMs) AS p99
FROM trace_metrics
WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime}
  AND TotalDurationMs > 0
GROUP BY bucket
ORDER BY bucket`,
    ),
  },
  {
    id: "satisfaction-over-time",
    title: "Satisfaction over time",
    definition: definition(
      satisfactionCode,
      `SELECT toStartOfDay(OccurredAt) AS bucket, avg(SatisfactionScore) AS satisfaction
FROM traces
WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime}
  AND SatisfactionScore IS NOT NULL
GROUP BY bucket
ORDER BY bucket`,
    ),
  },
  {
    id: "evaluation-pass-rate",
    title: "Evaluation pass rate",
    definition: definition(
      evaluationPassRateCode,
      `SELECT toStartOfDay(OccurredAt) AS bucket,
  countIf(Passed = 1) AS passed,
  countIf(isNotNull(Passed)) AS scored
FROM evaluation_metrics
WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime}
GROUP BY bucket
ORDER BY bucket`,
    ),
  },
  {
    id: "average-traces-per-thread",
    title: "Average traces per thread",
    definition: definition(
      avgTracesPerThreadCode,
      `SELECT day, avg(trace_count) AS avg_traces_per_thread
FROM (
  SELECT toStartOfDay(OccurredAt) AS day, ConversationId, count() AS trace_count
  FROM trace_metrics
  WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime}
    AND ConversationId IS NOT NULL
    AND TotalDurationMs > 0
  GROUP BY day, ConversationId
)
GROUP BY day
ORDER BY day`,
    ),
  },
  {
    id: "top-models",
    title: "Top models",
    definition: definition(
      topModelsCode,
      `SELECT model, uniqExact(TraceId) AS traces
FROM (
  SELECT TraceId, arrayJoin(Models) AS model
  FROM trace_metrics
  WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime}
    AND TotalDurationMs > 0
)
GROUP BY model
ORDER BY traces DESC
LIMIT 10`,
    ),
  },
  {
    id: "top-topics",
    title: "Top topics",
    definition: definition(
      topTopicsCode,
      `SELECT if(t.TopicName IS NULL OR t.TopicName = '', x.TopicId, t.TopicName) AS topic, x.traces AS traces
FROM (
  SELECT TopicId, uniqExact(TraceId) AS traces
  FROM trace_metrics
  WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime}
    AND TopicId IS NOT NULL AND TopicId != ''
  GROUP BY TopicId
) AS x
LEFT JOIN topics AS t ON t.TopicId = x.TopicId
ORDER BY traces DESC
LIMIT 10`,
    ),
  },
];
