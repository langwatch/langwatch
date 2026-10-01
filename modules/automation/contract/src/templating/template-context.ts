import { type Instant, nowInstant, toDate } from "@langwatch/time";

import type { AlertType } from "../trigger.ts";

/**
 * The variable contract every trigger-notification template renders against, for
 * both immediate (`matches.length === 1`) and digest (`length === N`) dispatch —
 * same template, no `{% if digest %}` branch. See ADR-036.
 */
export interface TemplateContext {
  trigger: TemplateTriggerVars;
  project: TemplateProjectVars;
  digest: TemplateDigestVars;
  /**
   * Convenience handle equal to `matches[0] ?? null`, for templates that only
   * expect a single immediate dispatch. `matches[]` is the canonical surface — see ADR-036.
   */
  match: TemplateMatchVars | null;
  /** Iterable matches for both immediate and digest dispatch. ADR-036 + ADR-026. */
  matches: TemplateMatchVars[];
}

export interface TemplateTriggerVars {
  id: string;
  name: string;
  alertType: AlertType | null;
  /** Deep link to the automation's edit page: `{{ project.url }}/automations` with
   *  `drawer.open=automation&drawer.automationId=<id>&drawer.source=email-link`, which
   *  also triggers an "Opened from an email notification" banner in the drawer. */
  editUrl: string;
}

export interface TemplateProjectVars {
  name: string;
  slug: string;
  url: string;
}

export interface TemplateDigestVars {
  /** Number of matches in this dispatch. 1 for immediate, N for a digest. */
  count: number;
  /** ISO-8601 window bounds for a digest; null for an immediate dispatch. */
  windowStart: string | null;
  windowEnd: string | null;
}

export interface TemplateMatchVars {
  trace: TemplateTraceVars;
  /** Null for trace-only triggers; populated for evaluation triggers. */
  evaluation: TemplateEvaluationVars | null;
}

export interface TemplateTraceVars {
  id: string | null;
  input: string;
  output: string;
  url: string;
  metadata: Record<string, unknown>;
}

export interface TemplateEvaluationVars {
  score: number | null;
  passed: boolean | null;
  label: string | null;
  evaluatorName: string | null;
}

/** A single matched subject, as seen by the dispatch layer before mapping. */
export interface TemplateMatchInput {
  traceId?: string | null;
  graphId?: string | null;
  input?: string | null;
  output?: string | null;
  metadata?: Record<string, unknown> | null;
  evaluation?: TemplateEvaluationVars | null;
}

function matchUrl({
  baseHost,
  projectSlug,
  traceId,
  graphId,
}: {
  baseHost: string;
  projectSlug: string;
  traceId?: string | null;
  graphId?: string | null;
}): string {
  if (graphId) {
    return `${baseHost}/${projectSlug}/analytics/custom/${graphId}`;
  }
  if (traceId) {
    return `${baseHost}/${projectSlug}/traces/${traceId}`;
  }
  return "#";
}

/**
 * Template contract for custom-graph threshold alerts (ADR-034 Phase 8.1); renders
 * through the same engine as trace-iteration shapes with a different variable surface.
 */
export interface GraphAlertTemplateContext {
  trigger: GraphAlertTriggerVars;
  graph: GraphAlertGraphVars;
  metric: GraphAlertMetricVars;
  condition: GraphAlertConditionVars;
  /** The metric value the evaluator just read for the alert's window. */
  currentValue: number;
  /** ISO-8601 timestamp the evaluator considered to be "now". */
  occurredAt: string;
  /** Same enum the evaluator carries (`real-time` / `heartbeat-absence`
   *  / `heartbeat-resolve`). Surfaced so a custom template can branch on
   *  it if needed. */
  reason: "real-time" | "heartbeat-absence" | "heartbeat-resolve";
  /** The metric's recent numeric history (chronological, oldest first) —
   *  the buckets the evaluator read around the alert window. Templates can
   *  iterate this to render their own representation (a table, an ASCII
   *  chart); `sparkline` below is the prebuilt shorthand. Empty when the
   *  evaluator had no buckets (e.g. heartbeat absence on total silence). */
  history: GraphAlertHistoryPoint[];
  /** Unicode sparkline (`▁▂▄▆█`) of `history`, prebuilt here because
   *  value→glyph mapping is impractical in Liquid. Empty string when
   *  `history` is empty. Renders monospace-safe in Slack mrkdwn and email. */
  sparkline: string;
  /** The metric's value over the window immediately preceding the alert
   *  window (same aggregation), for "was X, now Y" phrasing. Null when the
   *  evaluator had no preceding buckets. */
  previousValue: number | null;
  project: GraphAlertProjectVars;
}

export interface GraphAlertHistoryPoint {
  /** ISO-8601 bucket timestamp. */
  timestamp: string;
  value: number;
}

export interface GraphAlertTriggerVars {
  id: string;
  name: string;
  /** `INFO` / `WARNING` / `CRITICAL`. Plain string (not the Prisma enum)
   *  so this module stays Prisma-free for the test fixtures. */
  alertType: "INFO" | "WARNING" | "CRITICAL" | null;
  /** Deep link to the automation's edit page — same shape as the
   *  trace-context `editUrl` so chrome-footer rendering is uniform. */
  editUrl: string;
}

export interface GraphAlertGraphVars {
  id: string;
  name: string;
  /** Deep link to the custom-graph dashboard page. */
  url: string;
}

export interface GraphAlertMetricVars {
  /** Human-readable label, e.g. "Trace count". Derived from the series'
   *  display name when set; falls back to the series-name string the
   *  trigger stored. */
  label: string;
  /** The internal series identifier the trigger references — same
   *  `index/key/aggregation` string the evaluator parses. */
  seriesName: string;
}

export interface GraphAlertConditionVars {
  /** Raw operator the trigger stored (`gt`, `lt`, `gte`, `lte`, `eq`). */
  operator: string;
  /** Human-readable operator phrasing for subjects/bodies, e.g. "is
   *  greater than". */
  operatorLabel: string;
  threshold: number;
  /** Window the evaluator used, in minutes (mirror of `actionParams.timePeriod`). */
  timePeriodMinutes: number;
  /** Human-readable window label, e.g. "last 60 minutes". */
  timePeriodLabel: string;
}

export interface GraphAlertProjectVars {
  id: string;
  name: string;
  slug: string;
  /** Project home URL — also used by the email-chrome footer. */
  url: string;
}

function operatorLabel(operator: string): string {
  switch (operator) {
    case "gt":
      return "is greater than";
    case "gte":
      return "is greater than or equal to";
    case "lt":
      return "is less than";
    case "lte":
      return "is less than or equal to";
    case "eq":
      return "is equal to";
    default:
      return operator;
  }
}

function timePeriodLabel(minutes: number): string {
  if (minutes === 1) return "last 1 minute";
  if (minutes < 60) return `last ${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) {
    return hours === 1 ? "last 1 hour" : `last ${hours} hours`;
  }
  return `last ${minutes} minutes`;
}

/**
 * Neutralise CR/LF/NUL to close the header-injection vector when a value flows into
 * an email subject or Slack payload — not a substitute for context-specific escaping.
 */
function stripHeaderInjection(input: string): string {
  return input.replace(/[\r\n\0]+/g, " ");
}

const SPARKLINE_GLYPHS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

/**
 * Map a numeric series onto `▁▂▃▄▅▆▇█`. A flat series (min === max)
 * renders as the mid glyph so "constant 5" doesn't read as "zero".
 */
function buildSparkline(values: number[]): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return SPARKLINE_GLYPHS[3].repeat(values.length);
  return values
    .map((v) => {
      const idx = Math.round(((v - min) / (max - min)) * (SPARKLINE_GLYPHS.length - 1));
      return SPARKLINE_GLYPHS[idx] ?? SPARKLINE_GLYPHS[0];
    })
    .join("");
}

/** Single source of the automations-drawer deep link both context builders
 *  embed as `trigger.editUrl` — the query-string contract `useDrawer` parses. */
function buildAutomationEditUrl({
  projectUrl,
  triggerId,
}: {
  projectUrl: string;
  triggerId: string;
}): string {
  return `${projectUrl}/automations?drawer.open=automation&drawer.automationId=${triggerId}&drawer.source=email-link`;
}

/**
 * Builds alert template context (ADR-034 Phase 8.1); graph URL carries incident window
 * as query params so the link lands on the spike, not "now".
 */
export function buildGraphAlertTemplateContext({
  trigger,
  graph,
  metric,
  condition,
  currentValue,
  occurredAt,
  reason,
  history,
  previousValue,
  window,
  project,
  baseHost,
}: {
  trigger: {
    id: string;
    name: string;
    alertType: "INFO" | "WARNING" | "CRITICAL" | null;
  };
  graph: { id: string; name: string };
  metric: { label: string; seriesName: string };
  condition: {
    operator: string;
    threshold: number;
    timePeriodMinutes: number;
  };
  currentValue: number;
  occurredAt: Instant;
  reason: GraphAlertTemplateContext["reason"];
  /** Recent buckets around the alert window (chronological). Optional so
   *  callers without timeseries access (preview, test-fire) can omit it. */
  history?: { timestamp: Instant | string; value: number }[];
  /** Aggregated value over the window preceding the alert window. */
  previousValue?: number | null;
  /** Incident window appended to `graph.url` as `startDate`/`endDate`. */
  window?: { start: Instant; end: Instant };
  project: { id: string; name: string; slug: string };
  baseHost: string;
}): GraphAlertTemplateContext {
  const projectUrl = `${baseHost}/${project.slug}`;
  const baseGraphUrl = matchUrl({
    baseHost,
    projectSlug: project.slug,
    graphId: graph.id,
  });
  const graphUrl = window
    ? `${baseGraphUrl}?startDate=${encodeURIComponent(toDate(window.start).toISOString())}&endDate=${encodeURIComponent(toDate(window.end).toISOString())}`
    : baseGraphUrl;
  const historyPoints: GraphAlertHistoryPoint[] = (history ?? []).map((point) => ({
    timestamp:
      typeof point.timestamp === "string" ? point.timestamp : toDate(point.timestamp).toISOString(),
    value: point.value,
  }));
  return {
    trigger: {
      id: trigger.id,
      // tpl5015-005: trigger.name is user-set and lands verbatim in the email
      // subject. Strip CR/LF so a hostile name can't inject an extra header.
      name: stripHeaderInjection(trigger.name),
      alertType: trigger.alertType,
      editUrl: buildAutomationEditUrl({ projectUrl, triggerId: trigger.id }),
    },
    graph: {
      id: graph.id,
      name: graph.name,
      url: graphUrl,
    },
    metric: {
      // tpl5015-001: metric.label is derived from user-set series display
      // names and lands verbatim in the email subject. Strip CR/LF so a
      // hostile label can't inject an extra header via the SMTP subject line.
      label: stripHeaderInjection(metric.label),
      seriesName: metric.seriesName,
    },
    condition: {
      operator: condition.operator,
      operatorLabel: operatorLabel(condition.operator),
      threshold: condition.threshold,
      timePeriodMinutes: condition.timePeriodMinutes,
      timePeriodLabel: timePeriodLabel(condition.timePeriodMinutes),
    },
    currentValue,
    occurredAt: toDate(occurredAt).toISOString(),
    reason,
    history: historyPoints,
    sparkline: buildSparkline(historyPoints.map((point) => point.value)),
    previousValue: previousValue ?? null,
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      url: projectUrl,
    },
  };
}

/**
 * Example alert context for the preview pane and test-fire (no real alert fired).
 * Mirrors the shape `dispatchGraphAlertAction` renders, with recognisable placeholders.
 */
export function buildExampleGraphAlertTemplateContext({
  baseHost,
  project,
  trigger,
  graph,
  metricLabel,
  condition,
}: {
  baseHost: string;
  project: { id?: string; name: string; slug: string };
  trigger?: {
    id?: string;
    name?: string;
    alertType?: "INFO" | "WARNING" | "CRITICAL" | null;
  };
  graph?: { id?: string; name?: string };
  metricLabel?: string;
  condition?: {
    operator?: string;
    threshold?: number;
    timePeriodMinutes?: number;
  };
}): GraphAlertTemplateContext {
  const occurredAt = nowInstant();
  const exampleHistory = [4, 5, 4, 6, 7, 9, 12].map((value, i) => ({
    timestamp: occurredAt.subtract({ milliseconds: (6 - i) * 5 * 60 * 1000 }),
    value,
  }));
  return buildGraphAlertTemplateContext({
    trigger: {
      id: trigger?.id ?? "example-trigger",
      name: trigger?.name ?? "Example alert",
      alertType: trigger?.alertType ?? "WARNING",
    },
    graph: {
      id: graph?.id ?? "example-graph",
      name: graph?.name ?? "Example graph",
    },
    metric: {
      label: metricLabel ?? "Trace count",
      seriesName: "0/trace_id/cardinality",
    },
    condition: {
      operator: condition?.operator ?? "gt",
      threshold: condition?.threshold ?? 10,
      timePeriodMinutes: condition?.timePeriodMinutes ?? 30,
    },
    currentValue: 12,
    previousValue: 7,
    history: exampleHistory,
    occurredAt,
    reason: "real-time",
    project: {
      id: project.id ?? "example-project",
      name: project.name,
      slug: project.slug,
    },
    baseHost,
  });
}

/**
 * Maps dispatch-layer match data into the template variable contract.
 * `baseHost` is injected (not read from env here) so the renderer stays pure
 * and testable.
 */
export function buildTemplateContext({
  trigger,
  project,
  baseHost,
  matches,
  window,
}: {
  /** Caller-supplied trigger vars *without* `editUrl` — we derive it here
   *  from `baseHost` + project slug + trigger id so the template author
   *  doesn't need to assemble a URL by hand. */
  trigger: {
    id: string;
    name: string;
    alertType: AlertType | null;
  };
  project: { name: string; slug: string };
  baseHost: string;
  matches: TemplateMatchInput[];
  window?: { start?: Instant | null; end?: Instant | null };
}): TemplateContext {
  const mapped: TemplateMatchVars[] = matches.map((match) => ({
    trace: {
      id: match.traceId ?? null,
      input: match.input ?? "",
      output: match.output ?? "",
      url: matchUrl({
        baseHost,
        projectSlug: project.slug,
        traceId: match.traceId,
        graphId: match.graphId,
      }),
      metadata: match.metadata ?? {},
    },
    evaluation: match.evaluation ?? null,
  }));
  const projectUrl = `${baseHost}/${project.slug}`;
  return {
    trigger: {
      ...trigger,
      // tpl5015-005: trigger.name is user-set and lands verbatim in the email
      // subject. Strip CR/LF so a hostile name can't inject an extra header.
      name: stripHeaderInjection(trigger.name),
      editUrl: buildAutomationEditUrl({ projectUrl, triggerId: trigger.id }),
    },
    project: {
      name: project.name,
      slug: project.slug,
      url: projectUrl,
    },
    digest: {
      count: matches.length,
      windowStart: window?.start ? toDate(window.start).toISOString() : null,
      windowEnd: window?.end ? toDate(window.end).toISOString() : null,
    },
    match: mapped[0] ?? null,
    matches: mapped,
  };
}

/** What a report sends. Mirrors the `ReportSource` discriminator so a template
 *  can branch on it without the dispatcher pre-rendering the decision. */
export type ReportSourceKind = "traceQuery" | "customGraph" | "dashboard";

/**
 * One trace in a trace-query report. Typed rather than pre-formatted: `costUsd` /
 * `durationMs` go into NUMERIC Block Kit cells (`raw_number`), which Slack right-aligns.
 */
export interface ReportTraceRow {
  traceId: string;
  /** Deep link to this trace. */
  url: string;
  timestamp: string;
  /** Whitespace-collapsed, length-capped input preview. */
  input: string;
  output: string;
  /** Comma-joined model list, or "" when the trace recorded none. */
  model: string;
  status: "ok" | "error" | "warning";
  costUsd: number;
  durationMs: number;
}

export interface ReportChartPoint {
  label: string;
  value: number;
}

export interface ReportChartSeries {
  name: string;
  data: ReportChartPoint[];
}

/**
 * One panel of a report: a custom graph's series over the report window,
 * already shaped for a Block Kit `data_visualization` block. A dashboard
 * report carries one of these per panel; a custom-graph report carries one.
 */
export interface ReportChart {
  id: string;
  title: string;
  /** The four chart types Slack renders. The graph's own type is mapped onto
   *  the nearest of these (e.g. stacked_bar → bar, donnut → pie). */
  type: "line" | "bar" | "area" | "pie";
  /** X-axis labels (the window's time buckets). Empty for a pie. */
  categories: string[];
  /** Empty for a pie — a pie carries `segments` instead. */
  series: ReportChartSeries[];
  /** Pie segments (one per group). Empty for every other chart type. */
  segments: ReportChartPoint[];
  /** Headline value of the primary series across the window, aggregated the
   *  way the series itself aggregates (counts sum, everything else averages). */
  total: number;
  /** True when the graph returned no data points for the window. */
  isEmpty: boolean;
}

/**
 * Template contract for scheduled reports (ADR-044); data is structured (traces,
 * charts), not pre-rendered; rows derived from traces for template compatibility.
 */
export interface ReportTemplateContext {
  trigger: { id: string; name: string; editUrl: string };
  report: {
    /** Human source description, e.g. "Top 5 matching traces". */
    sourceLabel: string;
    /** Human schedule description, e.g. "every Monday at 09:00 (UTC)". */
    scheduleLabel: string;
    /** Which of the three sources this report sends. */
    sourceKind: ReportSourceKind;
    /** True when the report found nothing for its window — no matching traces,
     *  or every chart came back without data points. Templates lead with a
     *  "nothing to show" line rather than rendering an empty table. */
    isEmpty: boolean;
  };
  /** Deep link to view the report's underlying data (traces / graph / board). */
  viewUrl: string;
  /** The matching traces. Empty for graph and dashboard reports. */
  traces: ReportTraceRow[];
  /** The report's charts — one per panel. Empty for trace-query reports. */
  charts: ReportChart[];
  /** Legacy pre-rendered line per trace (`"<id> — <input>"`), derived from
   *  `traces`. Saved templates iterate this; new ones should use `traces`. */
  rows: string[];
  occurredAt: string;
  project: { id: string; name: string; slug: string; url: string };
}

/** Max chars of the input/output snippet carried into a report row. */
const REPORT_SNIPPET_MAX = 120;

/** Whitespace-collapse and length-cap a trace preview for a report row. */
export function reportSnippet(
  value: string | null | undefined,
  max: number = REPORT_SNIPPET_MAX,
): string {
  const collapsed = (value ?? "").replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1)}…`;
}

/**
 * The legacy `rows` line for one trace. No escaping here — templates pipe rows
 * through `mrkdwn_escape`. Falls back to the bare trace id with no input preview.
 */
export function formatReportRowLine(row: ReportTraceRow): string {
  return row.input ? `${row.traceId} — ${row.input}` : row.traceId;
}

function exampleChartTitles(sourceKind: ReportSourceKind): string[] {
  if (sourceKind === "dashboard") return ["Traces per hour", "Cost by model"];
  return ["Traces per hour"];
}

function exampleSourceLabel(sourceKind: ReportSourceKind): string {
  if (sourceKind === "traceQuery") return "Top 5 matching traces";
  if (sourceKind === "dashboard") return "Dashboard";
  return "Custom graph";
}

/**
 * Example report context for the drawer's preview and unknown-variable check —
 * without it, a preview renders against the TRACE context and every variable
 * resolves empty. Mirrors the real shape: trace-query gets traces, graph/dashboard charts.
 */
export function buildExampleReportTemplateContext({
  baseHost,
  project,
  trigger,
  sourceKind,
  sourceLabel,
  scheduleLabel,
  chartTitles,
}: {
  baseHost: string;
  project: { id?: string; name: string; slug: string };
  trigger?: { id?: string; name?: string };
  sourceKind: ReportSourceKind;
  sourceLabel?: string;
  scheduleLabel?: string;
  /** Real panel names when the author has already picked a graph/dashboard. */
  chartTitles?: string[];
}): ReportTemplateContext {
  const occurredAt = nowInstant();
  const projectSlug = project.slug;
  const exampleTraces: ReportTraceRow[] =
    sourceKind === "traceQuery"
      ? [
          {
            traceId: "trace_a1b2c3",
            input: "Summarize the Q3 earnings call.",
            output: "Revenue grew 12% year over year.",
            model: "gpt-5-mini",
            status: "error",
            costUsd: 0.0241,
            durationMs: 1834,
          },
          {
            traceId: "trace_d4e5f6",
            input: "What is our refund policy for annual plans?",
            output: "Annual plans are refundable within 30 days.",
            model: "gpt-5-mini",
            status: "ok",
            costUsd: 0.0102,
            durationMs: 920,
          },
          {
            traceId: "trace_g7h8i9",
            input: "Draft a reply to the escalation from Acme.",
            output: "Hi — thanks for flagging this…",
            model: "claude-opus-4-8",
            status: "warning",
            costUsd: 0.0518,
            durationMs: 3120,
          },
        ].map((trace, index) => ({
          ...trace,
          url: `${baseHost}/${projectSlug}/traces/${trace.traceId}`,
          timestamp: toDate(
            occurredAt.subtract({ milliseconds: (index + 1) * 60 * 60 * 1000 }),
          ).toISOString(),
          status: trace.status as ReportTraceRow["status"],
        }))
      : [];

  const titles =
    chartTitles && chartTitles.length > 0 ? chartTitles : exampleChartTitles(sourceKind);
  const exampleCharts: ReportChart[] =
    sourceKind === "traceQuery"
      ? []
      : titles.slice(0, 8).map((title, index) => {
          const categories = ["09:00", "10:00", "11:00", "12:00", "13:00"];
          const values = [12, 18, 9, 24, 16].map((v) => v + index * 3);
          return {
            id: `example-graph-${index}`,
            title,
            type: "line" as const,
            categories,
            series: [
              {
                name: title,
                data: categories.map((label, i) => ({
                  label,
                  value: values[i] ?? 0,
                })),
              },
            ],
            segments: [],
            total: values.reduce((a, b) => a + b, 0),
            isEmpty: false,
          };
        });

  return buildReportTemplateContext({
    trigger: {
      id: trigger?.id ?? "example-trigger",
      name: trigger?.name ?? "Example report",
    },
    report: {
      sourceKind,
      sourceLabel: sourceLabel ?? exampleSourceLabel(sourceKind),
      scheduleLabel: scheduleLabel ?? "every Monday at 09:00 (UTC)",
    },
    viewUrl:
      sourceKind === "traceQuery"
        ? `${baseHost}/${projectSlug}/traces`
        : `${baseHost}/${projectSlug}/analytics`,
    traces: exampleTraces,
    charts: exampleCharts,
    occurredAt,
    project: {
      id: project.id ?? "example-project",
      name: project.name,
      slug: projectSlug,
    },
    baseHost,
  });
}

/** Pure builder for the report template context (ADR-044). */
export function buildReportTemplateContext({
  trigger,
  report,
  viewUrl,
  traces = [],
  charts = [],
  occurredAt,
  project,
  baseHost,
}: {
  trigger: { id: string; name: string };
  report: {
    sourceLabel: string;
    scheduleLabel: string;
    sourceKind: ReportSourceKind;
  };
  viewUrl: string;
  traces?: ReportTraceRow[];
  charts?: ReportChart[];
  occurredAt: Instant;
  project: { id: string; name: string; slug: string };
  baseHost: string;
}): ReportTemplateContext {
  const projectUrl = `${baseHost}/${project.slug}`;
  // A trace report is empty when nothing matched; a chart report is empty when
  // it has no charts at all, or every chart came back without data points.
  const isEmpty =
    report.sourceKind === "traceQuery"
      ? traces.length === 0
      : charts.every((chart) => chart.isEmpty);
  return {
    trigger: {
      id: trigger.id,
      // tpl5015-005: trigger.name is user-set and lands verbatim in the email
      // subject. Strip CR/LF so a hostile name can't inject an extra header.
      name: stripHeaderInjection(trigger.name),
      editUrl: buildAutomationEditUrl({ projectUrl, triggerId: trigger.id }),
    },
    report: {
      sourceLabel: report.sourceLabel,
      scheduleLabel: report.scheduleLabel,
      sourceKind: report.sourceKind,
      isEmpty,
    },
    viewUrl,
    traces,
    charts,
    rows: traces.map(formatReportRowLine),
    occurredAt: toDate(occurredAt).toISOString(),
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      url: projectUrl,
    },
  };
}
