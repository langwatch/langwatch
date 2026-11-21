import type {
  LangWatchQLDiagnostic,
  LangWatchQLMemberWindow,
  RunSources,
} from "@langwatch/analytics-contract";

/** Says a named list of origins changed nothing because the statement never reads it (QP21). */
export function sourcesIgnoredDiagnostics({
  sourcesNamed,
  followsSources,
}: {
  sourcesNamed: boolean;
  followsSources: boolean;
}): LangWatchQLDiagnostic[] {
  if (!sourcesNamed || followsSources) return [];

  return [
    {
      code: "SOURCES_IGNORED",
      message: "This query doesn't read {dashboard_context_sources}, so it counts every origin.",
    },
  ];
}

/** Says the step ran coarser than asked, with both grains, so a card can show it (AC204). */
export function granularityCoarsenedDiagnostics({
  requestedSeconds,
  granularitySeconds,
}: {
  requestedSeconds: number | undefined;
  granularitySeconds: number | undefined;
}): LangWatchQLDiagnostic[] {
  if (requestedSeconds === undefined || granularitySeconds === undefined) return [];

  return [
    {
      code: "GRANULARITY_COARSENED",
      message: `The period is too long for ${requestedSeconds}-second steps, so the query ran at ${granularitySeconds}-second steps.`,
      meta: { requestedSeconds, granularitySeconds },
    },
  ];
}

/**
 * Says when a dated member's window cut this run's rows. It names no project and counts none:
 * a reader who cannot read a member must not learn it exists (dashboards-v2 AC213, QP26, QP28).
 */
export function shareWindowDiagnostics(
  memberWindows: readonly LangWatchQLMemberWindow[] | undefined,
): LangWatchQLDiagnostic[] {
  if (!memberWindows?.some((window) => window.from > 0)) return [];

  return [
    {
      code: "SHARE_WINDOW_LIMITED",
      message: "Some projects share data only from a date, so earlier rows are not included",
    },
  ];
}

/**
 * Says when a project the run reads has no member window, so none of its rows are read. Like
 * SHARE_WINDOW_LIMITED it names no project and counts none.
 */
export function shareWindowMissingDiagnostics({
  memberWindows,
  projectIds,
}: {
  memberWindows: readonly LangWatchQLMemberWindow[] | undefined;
  projectIds: readonly string[];
}): LangWatchQLDiagnostic[] {
  if (memberWindows === undefined) return [];
  const windowed = new Set(memberWindows.map((window) => window.projectId));
  if (projectIds.every((projectId) => windowed.has(projectId))) return [];

  return [
    {
      code: "SHARE_WINDOW_MISSING",
      message: "Some projects are not shared with this read, so none of their rows are included",
    },
  ];
}

/**
 * Says a multi-project read kept one copy of each team- or organization-level row, under the
 * lowest project id: a filter or GROUP BY on TenantId finds it there only (tasks#1212).
 */
export function sharedRowsDiagnostics(collapsesSharedRows: boolean): LangWatchQLDiagnostic[] {
  if (!collapsesSharedRows) return [];

  return [
    {
      code: "SHARED_ROWS_UNDER_LOWEST_PROJECT",
      message:
        "Rows shared by several of these projects, such as organization or team settings, " +
        "are counted once under the lowest project id, so a TenantId filter or GROUP BY " +
        "finds them there only.",
    },
  ];
}

/** The notes a run adds to what the database returned: what limited it, ignored or coarsened it. */
export function runNotes({
  memberWindows,
  projectIds,
  collapsesSharedRows,
  sources,
  followsSources,
  granularity,
}: {
  /** The windows naming a project the run reads; absent on a plain project. */
  memberWindows: readonly LangWatchQLMemberWindow[] | undefined;
  projectIds: readonly string[];
  /** Whether the read kept one copy of a row its views repeat per project. */
  collapsesSharedRows: boolean;
  sources: RunSources | undefined;
  followsSources: boolean;
  granularity: {
    granularitySeconds?: number | undefined;
    coarsenedFromSeconds?: number | undefined;
  };
}): LangWatchQLDiagnostic[] {
  return [
    ...shareWindowDiagnostics(memberWindows),
    ...shareWindowMissingDiagnostics({ memberWindows, projectIds }),
    ...sharedRowsDiagnostics(collapsesSharedRows),
    ...sourcesIgnoredDiagnostics({
      sourcesNamed: sources !== undefined && sources !== null,
      followsSources,
    }),
    ...granularityCoarsenedDiagnostics({
      requestedSeconds: granularity.coarsenedFromSeconds,
      granularitySeconds: granularity.granularitySeconds,
    }),
  ];
}
