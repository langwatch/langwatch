import { useSurelyInstantEvalChips } from "./use-surely-instant-eval-chips.ts";

/** Whether an Instant Eval chip of the query has a `NOT` no run can answer, as typed. */
export function useHasUnjudgeableEval(): boolean {
  return useSurelyInstantEvalChips().some((chip) => chip.isUnjudgeable);
}
