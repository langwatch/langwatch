import { isInstantEvalChipNegated } from "@langwatch/trace-contract";

import { useFilterStore } from "../../../behavior/explorer.store.ts";
import { useSurelyInstantEvalChips } from "./use-surely-instant-eval-chips.ts";

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
