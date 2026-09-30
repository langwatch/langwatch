import { useMemo } from "react";
import {
  type InstantEvalRunReference,
  type ResolvedInstantEvalChip,
  resolveInstantEvalChips,
} from "~/server/app-layer/traces/query-language/instantEvalChips";
import { useExplorerStore } from "../stores/explorerStore";

export interface InstantEvalRunsResult {
  /** The eval chips of the debounced query, each with its run or none. */
  chips: ResolvedInstantEvalChip[];
  /**
   * What every read sends: one entry per chip the store holds a run for.
   * Absent when the query carries no such chip, so the read's input is what
   * it was before Instant Evals.
   */
  evalRuns: Record<string, InstantEvalRunReference> | undefined;
}

/**
 * The eval chips of the query the reads are running, matched to the runs the
 * store registered. Read from the debounced query and window so the map rides
 * with the same input as the list, the facets and the new count.
 */
export function useInstantEvalRuns(): InstantEvalRunsResult {
  const queryText = useExplorerStore((s) => s.debouncedQueryText);
  const timeRange = useExplorerStore((s) => s.debouncedTimeRange);
  const runsByKey = useExplorerStore((s) => s.evalRuns);
  const lensId = useExplorerStore((s) => s.activeLensId);
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
    [
      queryText,
      lensId,
      timeRange.from,
      timeRange.to,
      timeRange.presetId,
      runsByKey,
    ],
  );
}
