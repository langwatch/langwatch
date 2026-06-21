import type { AlertType } from "@prisma/client";

/**
 * The single variable contract every trigger-notification template renders
 * against, for both immediate and digest dispatch (see ADR-028).
 *
 * Templates always iterate `matches`: an immediate dispatch sets
 * `matches.length === 1`, a digest sets it to N. The same template handles
 * both — there is no `{% if digest %}` branch to write.
 */
export interface TemplateContext {
  trigger: TemplateTriggerVars;
  project: TemplateProjectVars;
  digest: TemplateDigestVars;
  /**
   * Convenience handle for the first matched trace, equivalent to
   * `matches[0] ?? null`. Useful in `{{ match.* }}` style references when the
   * author knows they're handling a single immediate dispatch and doesn't want
   * the iteration syntax. The canonical variable surface is `matches[]` —
   * templates iterating `{% for m in matches %}` work identically for an
   * immediate dispatch (length 1) and a digest (length N). See ADR-028.
   */
  match: TemplateMatchVars | null;
  /** Iterable matches for both immediate and digest dispatch. ADR-028 + ADR-026. */
  matches: TemplateMatchVars[];
}

export interface TemplateTriggerVars {
  id: string;
  name: string;
  alertType: AlertType | null;
  /** Deep link to the automation's edit page — `{{ project.url }}/automations`
   *  with `drawer.open=automation&drawer.automationId=<id>&drawer.source=email-link`,
   *  matching the query-param contract `useDrawer` consumes so navigation
   *  lands on the Automations page with the edit drawer already open. The
   *  `drawer.source=email-link` marker lets the drawer surface a small
   *  "Opened from an email notification" banner so the operator has context
   *  for why they're here. */
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
    return `${baseHost}/${projectSlug}/messages/${traceId}`;
  }
  return "#";
}

/**
 * Template-variable contract for custom-graph THRESHOLD ALERTS (ADR-034
 * Phase 8.1). Distinct from `TemplateContext` (the trace-iteration shape)
 * because an alert reads as "metric X crossed threshold Y", not "these
 * traces happened" — there is no `matches` array, just one metric value
 * compared against a condition.
 *
 * Carried into both alert-default templates and any per-trigger custom
 * Liquid templates (the four Trigger columns). Renders through the same
 * `renderTriggerEmail` / `renderTriggerSlack` engine; only the variable
 * surface differs.
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
  project: GraphAlertProjectVars;
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
 * Pure builder for the alert template context (ADR-034 Phase 8.1).
 * `baseHost` is injected (not read from env) so the renderer stays pure
 * and testable. The graph URL points at the canonical custom-graph page
 * — same path `matchUrl` produces for graph-shaped trace matches, kept
 * in sync here so chrome / template URLs agree.
 */
export function buildGraphAlertTemplateContext({
  trigger,
  graph,
  metric,
  condition,
  currentValue,
  occurredAt,
  reason,
  project,
  baseHost,
}: {
  trigger: { id: string; name: string; alertType: "INFO" | "WARNING" | "CRITICAL" | null };
  graph: { id: string; name: string };
  metric: { label: string; seriesName: string };
  condition: {
    operator: string;
    threshold: number;
    timePeriodMinutes: number;
  };
  currentValue: number;
  occurredAt: Date;
  reason: GraphAlertTemplateContext["reason"];
  project: { id: string; name: string; slug: string };
  baseHost: string;
}): GraphAlertTemplateContext {
  const projectUrl = `${baseHost}/${project.slug}`;
  const graphUrl = matchUrl({
    baseHost,
    projectSlug: project.slug,
    graphId: graph.id,
  });
  return {
    trigger: {
      id: trigger.id,
      name: trigger.name,
      alertType: trigger.alertType,
      editUrl: `${projectUrl}/automations?drawer.open=automation&drawer.automationId=${trigger.id}&drawer.source=email-link`,
    },
    graph: {
      id: graph.id,
      name: graph.name,
      url: graphUrl,
    },
    metric: {
      label: metric.label,
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
    occurredAt: occurredAt.toISOString(),
    reason,
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      url: projectUrl,
    },
  };
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
  trigger: Omit<TemplateTriggerVars, "editUrl">;
  project: { name: string; slug: string };
  baseHost: string;
  matches: TemplateMatchInput[];
  window?: { start?: Date | null; end?: Date | null };
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
      editUrl: `${projectUrl}/automations?drawer.open=automation&drawer.automationId=${trigger.id}&drawer.source=email-link`,
    },
    project: {
      name: project.name,
      slug: project.slug,
      url: projectUrl,
    },
    digest: {
      count: matches.length,
      windowStart: window?.start ? window.start.toISOString() : null,
      windowEnd: window?.end ? window.end.toISOString() : null,
    },
    match: mapped[0] ?? null,
    matches: mapped,
  };
}
