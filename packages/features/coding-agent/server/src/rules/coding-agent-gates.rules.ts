/**
 * Viewer-scoped gates for the coding-agent read surfaces (the Sessions screen
 * and the pull request detail).
 *
 * A session row is facts about a run, with one exception: the title, which the
 * model wrote FROM the conversation. It therefore travels under content
 * visibility rather than under the permission that guards the numbers, and it
 * is the same rule the traces Sessions lens applies.
 *
 * The decisions themselves — may this viewer read the project's captured
 * content, may they price it — are resolved by the process and arrive here as
 * booleans, so the rule that produces them stays written down in exactly one
 * place.
 *
 * Spec: specs/coding-agent/sessions-screen.feature,
 *       specs/coding-agent/pull-request-linkage.feature.
 */

/** Blank the generated title for a viewer who may not read captured content. */
export function gateSessionListTitles<T extends { title: string | null }>({
  rows,
  canReadCapturedContent,
}: {
  rows: T[];
  canReadCapturedContent: boolean;
}): T[] {
  if (canReadCapturedContent) return rows;
  return rows.map((row) => ({ ...row, title: null }));
}

/**
 * Strip session spend for a viewer without cost:view.
 *
 * Nulled rather than zeroed: the row's own cost is nullable already, because a
 * session in a project the reader may not price reports its tokens with no
 * cost, and a zero here would read as "this session was free".
 */
export function gateSessionListCost<T extends { costUsd: number | null }>({
  rows,
  canSeeCosts,
}: {
  rows: T[];
  canSeeCosts: boolean;
}): T[] {
  if (canSeeCosts) return rows;
  return rows.map((row) => ({ ...row, costUsd: null }));
}

/**
 * Blank the title of every session whose project this reader may not read the
 * captured content of.
 *
 * Per project rather than per request: a pull request detail spans every
 * project of the organization the reader may see, and content visibility is
 * resolved per project (a data-privacy policy is a project's own). A reader
 * trusted with one project's conversations and not another's sees titles for
 * the first and none for the second, in one list.
 */
export function gatePullRequestSessionTitles<
  T extends { projectId: string; title: string | null },
>({
  sessions,
  contentProjectIds,
}: {
  sessions: T[];
  /** The projects whose captured content this reader may see. */
  contentProjectIds: ReadonlySet<string>;
}): T[] {
  return sessions.map((session) =>
    contentProjectIds.has(session.projectId) ? session : { ...session, title: null },
  );
}
