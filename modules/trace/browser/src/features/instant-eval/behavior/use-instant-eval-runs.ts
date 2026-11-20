import {
  INSTANT_EVAL_TARGET_FIELDS,
  isInstantEvalChipNegated,
  resolveInstantEvalChips,
} from "@langwatch/trace-contract";
import { useEffect, useMemo } from "react";

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
 * Whether a chip is surely an Instant Eval rather than an older bare evaluator name: it forces a
 * target, was submitted here as one in this project, or has a run registered under its key.
 */
export function isSurelyInstantEvalChip({
  chip,
  projectId,
  typedQuestions,
  runsByKey,
}: {
  chip: { field: string; question: string; key: string };
  projectId: string;
  typedQuestions: Readonly<Record<string, true>>;
  runsByKey: Readonly<Record<string, string>> | undefined;
}): boolean {
  return (
    Object.hasOwn(INSTANT_EVAL_TARGET_FIELDS, chip.field) ||
    Boolean(typedQuestions[typedQuestionKey({ projectId, question: chip.question })]) ||
    Boolean(runsByKey?.[chip.key])
  );
}

/** The debounced query's chips that are surely Instant Evals ({@link isSurelyInstantEvalChip}). */
function useSurelyInstantEvalChips(): InstantEvalRunsResult["chips"] {
  const runsByKey = useFilterStore((s) => s.evalRuns);
  const typedQuestions = useInstantEvalRunStore((s) => s.typedQuestions);
  const projectId = useViewStore((s) => s.projectId) ?? "";
  const { chips } = useInstantEvalRuns();
  return chips.filter((chip) =>
    isSurelyInstantEvalChip({ chip, projectId, typedQuestions, runsByKey }),
  );
}

/**
 * Whether an Instant Eval chip with no run has a `NOT` above it. It negates nothing judged, so the
 * reads would list every row; the table shows it as not judged instead. A bare chip never submitted
 * or run here may be an evaluator name from before Instant Evals, so it keeps its rows.
 */
export function useHasPendingNegatedEval(): boolean {
  const queryText = useFilterStore((s) => s.debouncedQueryText) ?? "";
  return useSurelyInstantEvalChips().some(
    (chip) =>
      chip.runId === null &&
      isInstantEvalChipNegated({ queryText, field: chip.field, question: chip.question }),
  );
}

/** Whether an Instant Eval chip of the query has a `NOT` no run can answer, as typed. */
export function useHasUnjudgeableEval(): boolean {
  return useSurelyInstantEvalChips().some((chip) => chip.isUnjudgeable);
}

/**
 * Marks each chip with a run registered under its key as submitted here, so a run a link
 * restored keeps a bare `NOT` chip pending, not read as an evaluator name, once the range changes.
 */
export function useMarkRegisteredChipsTyped(): void {
  const runsByKey = useFilterStore((s) => s.evalRuns);
  const projectId = useViewStore((s) => s.projectId);
  const { chips } = useInstantEvalRuns();
  useEffect(() => {
    if (!projectId) return;
    const { markTyped } = useInstantEvalRunStore.getState();
    for (const chip of chips) {
      if (runsByKey?.[chip.key]) markTyped({ projectId, question: chip.question });
    }
  }, [chips, runsByKey, projectId]);
}
