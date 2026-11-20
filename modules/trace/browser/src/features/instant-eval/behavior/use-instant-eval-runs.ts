import {
  INSTANT_EVAL_TARGET_FIELDS,
  isInstantEvalChipNegated,
  resolveInstantEvalChips,
} from "@langwatch/trace-contract";
import { useMemo } from "react";

import { useFilterStore, useViewStore } from "../../../behavior/explorer.store.ts";
import { typedQuestionKey, useInstantEvalRunStore } from "./instant-eval-run.store.ts";

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

/**
 * Whether an Instant Eval chip with no run has a `NOT` above it. It negates nothing judged, so the
 * reads would list every row; the table shows it as not judged instead. A bare chip never submitted
 * or run here may be an evaluator name from before Instant Evals, so it keeps its rows.
 */
export function useHasPendingNegatedEval(): boolean {
  const queryText = useFilterStore((s) => s.debouncedQueryText) ?? "";
  const runsByKey = useFilterStore((s) => s.evalRuns);
  const typedQuestions = useInstantEvalRunStore((s) => s.typedQuestions);
  const projectId = useViewStore((s) => s.projectId) ?? "";
  const { chips } = useInstantEvalRuns();
  return chips.some(
    (chip) =>
      chip.runId === null &&
      (Object.hasOwn(INSTANT_EVAL_TARGET_FIELDS, chip.field) ||
        Boolean(typedQuestions[typedQuestionKey({ projectId, question: chip.question })]) ||
        Boolean(runsByKey?.[chip.key])) &&
      isInstantEvalChipNegated({ queryText, field: chip.field, question: chip.question }),
  );
}
