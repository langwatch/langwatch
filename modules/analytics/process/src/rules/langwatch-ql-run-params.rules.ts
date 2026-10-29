import {
  DEFAULT_WIDGET_SOURCES,
  type LangWatchQLRunParams,
  type LangWatchQLTimeWindow,
  type RunSources,
  type TraceSource,
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

/** What a run was bound to and what its statement read, as the answer reports it. */
export function buildRunParams({
  sources,
  followsSources,
  projects,
  followedWindow,
  granularity,
  parameters,
}: {
  sources: readonly TraceSource[];
  followsSources: boolean;
  projects: readonly string[];
  /** The period the statement followed; absent when it followed none. */
  followedWindow: LangWatchQLTimeWindow | undefined;
  granularity: {
    granularitySeconds?: number | undefined;
    coarsenedFromSeconds?: number | undefined;
  };
  parameters: Readonly<Record<string, unknown>> | undefined;
}): LangWatchQLRunParams {
  return {
    sources,
    followsSources,
    projects,
    ...(followedWindow ? { period: { start: followedWindow.start, end: followedWindow.end } } : {}),
    ...(granularity.granularitySeconds === undefined
      ? {}
      : { granularitySeconds: granularity.granularitySeconds }),
    ...(granularity.coarsenedFromSeconds === undefined
      ? {}
      : { coarsenedFromSeconds: granularity.coarsenedFromSeconds }),
    parameters: { ...parameters },
  };
}
