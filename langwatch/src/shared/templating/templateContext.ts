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
