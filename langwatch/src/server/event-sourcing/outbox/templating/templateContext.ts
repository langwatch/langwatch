import type { AlertType } from "@prisma/client";

/**
 * The single variable contract every trigger-notification template renders
 * against, for both immediate and digest dispatch (see ADR-026).
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
   * The single matched trace for immediate-cadence dispatches. This is the
   * variable surface authors write against today (ADR-028); a digest cadence
   * (ADR-025, future) will expose `matches[]` for iteration. Both reference
   * the same underlying records — `match === matches[0] ?? null`.
   */
  match: TemplateMatchVars | null;
  /** Internal: kept on the context so the renderer can iterate when needed. */
  matches: TemplateMatchVars[];
}

export interface TemplateTriggerVars {
  id: string;
  name: string;
  message: string;
  alertType: AlertType | null;
  /** Deep link to the automation's edit page — `{{ project.url }}/automations`
   *  with a query param the page expands to open the drawer in edit mode.
   *  Used by the default email footer ("Click to edit this automation") so
   *  authors don't have to remember the URL shape. */
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
      editUrl: `${projectUrl}/automations?edit=${trigger.id}`,
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
