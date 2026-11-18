import {
  DEFAULT_WIDGET_SOURCES,
  type LangWatchQLQueryResult,
  type LangWatchQLRunParams,
  type LangWatchQLTimeWindow,
  type RunSources,
  type TraceSource,
  LWQL_TIME_WINDOW_PARAMETERS,
} from "@langwatch/analytics-contract";

import { runNotes } from "./langwatch-ql-run-notes.rules.ts";
import {
  langWatchQLExecutionParameters,
  type ValidatedLangWatchQL,
} from "./langwatch-ql-validation-shape.rules.ts";

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
 * its SQL name, plus `period` when the statement followed one. The two period placeholders fold
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
  // A statement that declares its own `{period:…}` keeps its value in the echo: the window never
  // overwrites what the caller bound.
  return {
    ...(followedWindow ? { period: { start: followedWindow.start, end: followedWindow.end } } : {}),
    ...placeholders,
  };
}

/** The result with what the run was bound to, and the notes on what limited or ignored it. */
export function withRunNotes({
  result,
  validation,
  granularity,
  followedWindow,
  memberWindows,
  sources,
}: {
  result: LangWatchQLQueryResult;
  validation: ValidatedLangWatchQL;
  granularity: Parameters<typeof langWatchQLExecutionParameters>[0]["granularity"];
  followedWindow: LangWatchQLTimeWindow | undefined;
  memberWindows: Parameters<typeof runNotes>[0]["memberWindows"];
  sources: Parameters<typeof runNotes>[0]["sources"];
}): LangWatchQLQueryResult {
  return {
    ...result,
    params: buildRunParams({
      bound: langWatchQLExecutionParameters({ validation, granularity }),
      followedWindow,
    }),
    diagnostics: [
      ...result.diagnostics,
      ...runNotes({
        memberWindows,
        sources,
        followsSources: validation.followsSources,
        granularity,
      }),
    ],
  };
}
