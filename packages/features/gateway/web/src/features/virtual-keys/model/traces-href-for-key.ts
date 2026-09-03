/**
 * Deep link from a virtual key to the traces it produced, in the project
 * those traces land in.
 *
 * The gateway stamps `langwatch.virtual_key_id` on every span it proxies and
 * the trace fold hoists it onto the trace summary, so the Trace Explorer can
 * filter on it directly. The window defaults to 30 days rather than the key's
 * whole life: a key that has been quiet for months would otherwise open on an
 * empty table with no hint that the filter, not the key, is what is narrow.
 * A caller reading a period of its own passes it, so the list it lands on
 * covers the same days as the numbers it was reading.
 */
import { escapeValue } from "@langwatch/trace-contract";

const TRACE_VIRTUAL_KEY_ATTRIBUTE = "trace.attribute.langwatch.virtual_key_id";

/** The Trace Explorer lens the link opens, its default listing. */
const ALL_TRACES_LENS = "all-traces";

const PRESET_ID = "30d";

/**
 * The period the link opens on: one of the explorer's own presets, or an
 * exact pair of instants for a period it has no preset for.
 *
 * The explorer reads `preset` in preference to `from`/`to`, so the two are
 * a union rather than two optional fields that could contradict each other.
 * Epoch milliseconds, both or neither, matching `parseFragment`.
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
 * The link for one key, or undefined when there is nothing worth linking to.
 *
 * `teams` carries only the teams the viewer belongs to, so a destination that
 * does not resolve to a slug is one they cannot open: the target page would
 * bounce them. A deleted destination resolves to nothing worth reading
 * either, since the project serves no traces any more.
 */
export function resolveTracesHrefForKey({
  teams,
  virtualKeyId,
  traceProjectId,
  traceProjectArchived,
  window,
  model,
}: {
  teams: ReadonlyArray<{
    projects: ReadonlyArray<{ id: string; slug: string }>;
  }>;
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
