import type { VariableInfo } from "~/shared/templating/exampleContext";

/**
 * Variable surface for scheduled-report templates (`draft.source ===
 * "report"`). Mirrors `TEMPLATE_VARIABLES` (the trace list) and
 * `ALERT_TEMPLATE_VARIABLES`, but describes `ReportTemplateContext` — "here is
 * your {source} for {period}". The drawer hands this list to the same editor
 * plumbing (Monaco autocomplete, unknown-variable detection, the variable
 * reference panel) via `ConfigFormCtx.variables`; only the data differs.
 *
 * A report carries its data STRUCTURED (`traces`, `charts`) rather than
 * pre-rendered, which is what lets a layout build a real table or chart. `rows`
 * remains for templates written against the older pre-formatted lines.
 */
export const REPORT_TEMPLATE_VARIABLES: VariableInfo[] = [
  {
    path: "trigger.name",
    type: "string",
    description: "The report's configured name.",
  },
  {
    path: "trigger.editUrl",
    type: "string",
    description: "Deep link to this report's edit page.",
  },
  {
    path: "report.sourceLabel",
    type: "string",
    description: 'What the report sends, e.g. "Top 5 matching traces".',
  },
  {
    path: "report.scheduleLabel",
    type: "string",
    description: 'When it runs, e.g. "every Monday at 09:00 (UTC)".',
  },
  {
    path: "report.sourceKind",
    type: "'traceQuery' | 'customGraph' | 'dashboard'",
    description: "Which of the three sources this report sends.",
  },
  {
    path: "report.isEmpty",
    type: "boolean",
    description:
      "True when nothing was found for the period — lead with a 'nothing to show' line instead of an empty table.",
  },
  {
    path: "viewUrl",
    type: "string",
    description: "Deep link to the report's underlying data.",
  },
  {
    path: "occurredAt",
    type: "string",
    description: "When the report ran (ISO-8601).",
  },
  {
    path: "traces",
    type: "ReportTrace[]",
    description:
      "The matching traces. Empty for graph and dashboard reports. Iterate with {% for t in traces %}.",
  },
  {
    path: "traces[].traceId",
    type: "string",
    description: "The trace's id.",
  },
  {
    path: "traces[].url",
    type: "string",
    description: "Deep link to the trace.",
  },
  {
    path: "traces[].input",
    type: "string",
    description: "The trace's input preview.",
  },
  {
    path: "traces[].output",
    type: "string",
    description: "The trace's output preview.",
  },
  {
    path: "traces[].model",
    type: "string",
    description: "The models the trace used.",
  },
  {
    path: "traces[].status",
    type: "'ok' | 'error' | 'warning'",
    description: "The trace's status.",
  },
  {
    path: "traces[].costUsd",
    type: "number",
    description: "Cost in USD — a number, so a table can use a numeric cell.",
  },
  {
    path: "traces[].durationMs",
    type: "number",
    description: "Duration in milliseconds.",
  },
  {
    path: "charts",
    type: "ReportChart[]",
    description:
      "One chart per panel. Empty for trace-query reports. A dashboard report carries one per panel.",
  },
  {
    path: "charts[].title",
    type: "string",
    description: "The graph's name.",
  },
  {
    path: "charts[].type",
    type: "'line' | 'bar' | 'area' | 'pie'",
    description: "The chart type Slack renders.",
  },
  {
    path: "charts[].total",
    type: "number",
    description: "Headline value of the primary series across the period.",
  },
  {
    path: "charts[].categories",
    type: "string[]",
    description: "X-axis labels (the period's time buckets). Empty for a pie.",
  },
  {
    path: "charts[].series",
    type: "{ name: string; data: { label: string; value: number }[] }[]",
    description: "The plotted series. Empty for a pie.",
  },
  {
    path: "charts[].segments",
    type: "{ label: string; value: number }[]",
    description: "Pie slices. Empty for every other chart type.",
  },
  {
    path: "charts[].isEmpty",
    type: "boolean",
    description: "True when this panel had no data points for the period.",
  },
  {
    path: "rows",
    type: "string[]",
    description:
      "Legacy pre-rendered line per trace. Prefer `traces`, which carries the fields separately.",
  },
  {
    path: "project.name",
    type: "string",
    description: "The project's name.",
  },
  {
    path: "project.url",
    type: "string",
    description: "Deep link to the project.",
  },
];
