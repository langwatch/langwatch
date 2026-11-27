import { useFilterStore, useViewStore } from "../../../behavior/explorer.store.ts";
import { isSurelyInstantEvalChip } from "../../../model/surely-instant-eval-chip.ts";
import { useInstantEvalRunStore } from "./instant-eval-run.store.ts";
import { type InstantEvalRunsResult, useInstantEvalRuns } from "./use-instant-eval-runs.ts";

/** The debounced query's chips that are surely Instant Evals ({@link isSurelyInstantEvalChip}). */
export function useSurelyInstantEvalChips(): InstantEvalRunsResult["chips"] {
  const runsByKey = useFilterStore((s) => s.evalRuns);
  const typedQuestions = useInstantEvalRunStore((s) => s.typedQuestions);
  const projectId = useViewStore((s) => s.projectId) ?? "";
  const { chips } = useInstantEvalRuns();
  return chips.filter((chip) =>
    isSurelyInstantEvalChip({ chip, projectId, typedQuestions, runsByKey }),
  );
}
