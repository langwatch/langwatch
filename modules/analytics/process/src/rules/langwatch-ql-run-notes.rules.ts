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

/** The notes a run adds to what the database returned: what limited it, ignored or coarsened it. */
export function runNotes({
  memberWindows,
  sources,
  followsSources,
  granularity,
}: {
  memberWindows: readonly LangWatchQLMemberWindow[] | undefined;
  sources: RunSources | undefined;
  followsSources: boolean;
  granularity: {
    granularitySeconds?: number | undefined;
    coarsenedFromSeconds?: number | undefined;
  };
}): LangWatchQLDiagnostic[] {
  return [
    ...shareWindowDiagnostics(memberWindows),
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
