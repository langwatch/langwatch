/**
 * Deep link from a virtual key to the traces it produced, in the project
 * those traces land in.
 *
 * The gateway stamps `langwatch.virtual_key_id` on every span it proxies and
 * the trace fold hoists it onto the trace summary, so the Trace Explorer can
 * filter on it directly. The window is 30 days rather than the key's whole
 * life: a key that has been quiet for months would otherwise open on an empty
 * table with no hint that the filter, not the key, is what is narrow.
 */
const TRACE_VIRTUAL_KEY_ATTRIBUTE = "trace.attribute.langwatch.virtual_key_id";

/** The Trace Explorer lens the link opens, its default listing. */
const ALL_TRACES_LENS = "all-traces";

const PRESET_ID = "30d";

export function tracesHrefForKey({
  projectSlug,
  virtualKeyId,
}: {
  projectSlug: string;
  virtualKeyId: string;
}): string {
  const params = new URLSearchParams({
    q: `${TRACE_VIRTUAL_KEY_ATTRIBUTE}:"${virtualKeyId}"`,
    preset: PRESET_ID,
  });
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
}: {
  teams: ReadonlyArray<{
    projects: ReadonlyArray<{ id: string; slug: string }>;
  }>;
  virtualKeyId: string;
  traceProjectId: string | null | undefined;
  traceProjectArchived: boolean | undefined;
}): string | undefined {
  if (!traceProjectId || traceProjectArchived) return undefined;
  for (const team of teams) {
    const project = team.projects.find((p) => p.id === traceProjectId);
    if (project) {
      return tracesHrefForKey({ projectSlug: project.slug, virtualKeyId });
    }
  }
  return undefined;
}
