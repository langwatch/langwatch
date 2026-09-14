// Viewer-scoped gates for Sessions screen and pull-request detail; title
// gated under content visibility, spend under cost:view; decisions pre-resolved
// as booleans.

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

/** Blank titles per project's content visibility, not request-level. */
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
