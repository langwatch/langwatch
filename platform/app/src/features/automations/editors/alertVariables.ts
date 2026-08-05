import type { VariableInfo } from "@langwatch/automations/templating/exampleContext";

/**
 * Variable surface for graph-alert templates (`draft.source ===
 * "customGraph"`). Mirrors `TEMPLATE_VARIABLES` (the trace list) but
 * describes `GraphAlertTemplateContext` — "metric X crossed threshold Y",
 * not "these traces matched". The drawer hands this list to the same
 * editor plumbing (Monaco autocomplete, unknown-variable detection,
 * variable reference panel) via `ConfigFormCtx.variables`; only the data
 * differs per source.
 */
export const ALERT_TEMPLATE_VARIABLES: VariableInfo[] = [
  {
    path: "trigger.name",
    type: "string",
    description: "The alert's configured name.",
  },
  {
    path: "trigger.alertType",
    type: "'INFO' | 'WARNING' | 'CRITICAL' | null",
    description: "Severity label, or null if unset.",
  },
  {
    path: "trigger.editUrl",
    type: "string",
    description: "Deep link to this alert's edit page.",
  },
  {
    path: "graph.name",
    type: "string",
    description: "Name of the custom graph the alert watches.",
  },
  {
    path: "graph.url",
    type: "string",
    description: "Deep link to the graph, focused on the alert window.",
  },
  {
    path: "metric.label",
    type: "string",
    description: "Human-readable label of the monitored series.",
  },
  {
    path: "metric.seriesName",
    type: "string",
    description: "Internal identifier of the monitored series.",
  },
  {
    path: "condition.operator",
    type: "'gt' | 'lt' | 'gte' | 'lte' | 'eq'",
    description: "Raw comparison operator the alert stores.",
  },
  {
    path: "condition.operatorLabel",
    type: "string",
    description: 'Readable operator phrasing, e.g. "is greater than".',
  },
  {
    path: "condition.threshold",
    type: "number",
    description: "The threshold the metric is compared against.",
  },
  {
    path: "condition.timePeriodMinutes",
    type: "number",
    description: "Evaluation window in minutes.",
  },
  {
    path: "condition.timePeriodLabel",
    type: "string",
    description: 'Readable window label, e.g. "last 60 minutes".',
  },
  {
    path: "currentValue",
    type: "number",
    description: "The metric value that crossed the threshold.",
  },
  {
    path: "previousValue",
    type: "number | null",
    description: "The metric's value over the preceding window.",
  },
  {
    path: "sparkline",
    type: "string",
    description: "Unicode sparkline of the metric's recent history.",
  },
  {
    path: "history",
    type: "Array<{ timestamp: string; value: number }>",
    description:
      "Recent metric buckets (chronological): iterate to render your own trend.",
  },
  {
    path: "occurredAt",
    type: "string",
    description: "ISO-8601 timestamp of when the alert fired.",
  },
  {
    path: "reason",
    type: "'real-time' | 'heartbeat-absence' | 'heartbeat-resolve'",
    description: "Why the alert fired.",
  },
  {
    path: "project.name",
    type: "string",
    description: "Human-readable project name.",
  },
  {
    path: "project.url",
    type: "string",
    description: "Absolute URL to the project home.",
  },
];
