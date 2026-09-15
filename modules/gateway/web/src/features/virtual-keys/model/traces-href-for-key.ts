/**
 * Deep link from a virtual key to its traces, filtered to 30 days by default.
 * The gateway stamps langwatch.virtual_key_id on every span it proxies.
 */
import { escapeValue } from "@langwatch/trace-contract";

const TRACE_VIRTUAL_KEY_ATTRIBUTE = "trace.attribute.langwatch.virtual_key_id";

/** The Trace Explorer lens the link opens, its default listing. */
const ALL_TRACES_LENS = "all-traces";

const PRESET_ID = "30d";

/**
 * The period the link opens on: one of the explorer's own presets, or an
 * exact instant pair for one it has none for. A union, not two optional
 * fields, since the explorer prefers `preset` and the two could contradict.
 */
export type TracesWindow = { presetId: string } | { fromMs: number; toMs: number };

export function tracesHrefForKey({
  projectSlug,
  virtualKeyId,
  window,
  model,
}: {
  projectSlug: string;
  virtualKeyId: string;
  window?: TracesWindow;
  /** Narrows the list to one model, spelled as the usage views spell it. */
  model?: string | null;
}): string {
  // Joined with an explicit " AND ": the query language has a default
  // combinator, and a link that reads correctly only because of it breaks
  // silently the day the default changes.
  const clauses = [`${TRACE_VIRTUAL_KEY_ATTRIBUTE}:"${virtualKeyId}"`];
  if (model) clauses.push(`model:${escapeValue(model)}`);

  const params = new URLSearchParams({ q: clauses.join(" AND ") });
  if (window && "fromMs" in window) {
    params.set("from", String(Math.floor(window.fromMs)));
    params.set("to", String(Math.floor(window.toMs)));
  } else {
    params.set("preset", window?.presetId ?? PRESET_ID);
  }
  return `/${projectSlug}/traces#${ALL_TRACES_LENS}?${params.toString()}`;
}

/**
 * The link for one key, or undefined when nothing is worth linking to.
 * `teams` carries only the viewer's own teams, so an unresolved slug is a
 * page they'd bounce from; a deleted destination has no traces to read either.
 */
export function resolveTracesHrefForKey({
  teams,
  virtualKeyId,
  traceProjectId,
  traceProjectArchived,
  window,
  model,
}: {
  teams: readonly {
    projects: readonly { id: string; slug: string }[];
  }[];
  virtualKeyId: string;
  traceProjectId: string | null | undefined;
  traceProjectArchived: boolean | undefined;
  window?: TracesWindow;
  model?: string | null;
}): string | undefined {
  if (!traceProjectId || traceProjectArchived) return undefined;
  for (const team of teams) {
    const project = team.projects.find((p) => p.id === traceProjectId);
    if (project) {
      return tracesHrefForKey({
        projectSlug: project.slug,
        virtualKeyId,
        window,
        model,
      });
    }
  }
  return undefined;
}
