import {
  DEFAULT_WIDGET_SOURCES,
  type LangWatchQLDiagnostic,
  type LangWatchQLMemberWindow,
  type LangWatchQLRunParams,
  type LangWatchQLTimeWindow,
  type RunSources,
  type TraceSource,
  LWQL_TIME_WINDOW_PARAMETERS,
} from "@langwatch/analytics-contract";

/** The first occurrence of each id, in the order sent. */
export function dedupeInOrder<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/**
 * The origins a run is bound to: the list named, a repeat kept at its first place; the default
 * when none is named, whether absent or `null` (the same default at every door).
 */
export function resolveRunSources(sources: RunSources | undefined): readonly TraceSource[] {
  return dedupeInOrder(sources ?? DEFAULT_WIDGET_SOURCES);
}

/**
 * What a run was bound to, as the answer reports it: each placeholder the statement declares by
 * its SQL name, then `period` when the statement followed one. The two period placeholders fold
 * into `period`, so the window is not told twice.
 */
export function buildRunParams({
  bound,
  followedWindow,
}: {
  bound: Readonly<Record<string, unknown>>;
  followedWindow: LangWatchQLTimeWindow | undefined;
}): LangWatchQLRunParams {
  const placeholders = Object.fromEntries(
    Object.entries(bound).filter(([name]) => !LWQL_TIME_WINDOW_PARAMETERS.some((p) => p === name)),
  );
  return {
    ...placeholders,
    ...(followedWindow ? { period: { start: followedWindow.start, end: followedWindow.end } } : {}),
  };
}

/** Says a named list of origins changed nothing because the statement never reads it (QP21). */
export function sourcesIgnoredDiagnostics({
  named,
  followsSources,
}: {
  named: boolean;
  followsSources: boolean;
}): LangWatchQLDiagnostic[] {
  if (!named || followsSources) return [];

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
      named: sources !== undefined && sources !== null,
      followsSources,
    }),
    ...granularityCoarsenedDiagnostics({
      requestedSeconds: granularity.coarsenedFromSeconds,
      granularitySeconds: granularity.granularitySeconds,
    }),
  ];
}
