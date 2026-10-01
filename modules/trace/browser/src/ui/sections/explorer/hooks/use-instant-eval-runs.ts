import { useFilterStore, useViewStore } from "@langwatch/trace-browser-kit";
import { resolveInstantEvalChips } from "@langwatch/trace-contract";
import { useMemo } from "react";

/**
 * The query's eval chips, each with its run or none, and the map every read
 * sends: one entry per chip the store holds a run for, absent when the query
 * carries no such chip.
 */
export type InstantEvalRunsResult = ReturnType<typeof resolveInstantEvalChips>;

/**
 * The eval chips of the query the reads are running, matched to the runs the
 * store registered. Read from the debounced query and window so the map rides
 * with the same input as the list, the sessions and the new count.
 * @see specs/traces-v2/instant-eval-search.feature
 */
export function useInstantEvalRuns(): InstantEvalRunsResult {
  const queryText = useFilterStore((s) => s.debouncedQueryText);
  const timeRange = useFilterStore((s) => s.debouncedTimeRange);
  const runsByKey = useFilterStore((s) => s.evalRuns);
  const lensId = useViewStore((s) => s.activeLensId);

  return useMemo(
    () =>
      resolveInstantEvalChips({
        queryText: queryText ?? "",
        lensId,
        window: {
          from: timeRange.from,
          to: timeRange.to,
          ...(timeRange.presetId ? { presetId: timeRange.presetId } : {}),
        },
        runsByKey: runsByKey ?? {},
      }),
    [queryText, lensId, timeRange.from, timeRange.to, timeRange.presetId, runsByKey],
  );
}
