/**
 * The four default judge prompts for the `select_best_compare` (Comparison) evaluator, one per
 * (golden × input) presence combo. Byte-identical with the `DEFAULT_SELECT_BEST_PROMPT*`
 * constants in `select_best_compare.py`, the source of truth — a parity test guards it.
 */
export const JUDGE_PROMPT_GOLDEN_INPUT =
  'Pick the best of N candidate replies to the task.\n\nTask:       {input}\nReference:  {golden}\n\nCandidates:\n{candidates}\n\nLook across the candidates and decide which one is the best reply.\nBriefly explain WHY it\'s better than the others, then pick the winning\nslot label. Use "tie" only when no candidate is clearly better.\n';

export const JUDGE_PROMPT_GOLDEN_NO_INPUT =
  'Pick the best of N candidate replies.\n\nReference:  {golden}\n\nCandidates:\n{candidates}\n\nCompare each candidate against the reference answer and decide which one\nis closest. Briefly explain WHY it\'s better than the others, then pick the\nwinning slot label. Use "tie" only when no candidate is clearly better.\n';

export const JUDGE_PROMPT_NO_GOLDEN_INPUT =
  'Pick the best of N candidate replies to the task — there is no reference\nanswer, so compare them on their own merits.\n\nTask:  {input}\n\nCandidates:\n{candidates}\n\nLook across the candidates and decide which one is the best reply.\nBriefly explain WHY it\'s better than the others, then pick the winning\nslot label. Use "tie" only when no candidate is clearly better.\n';

export const JUDGE_PROMPT_NO_GOLDEN_NO_INPUT =
  'Pick the best of N candidate replies — there is no task description or\nreference answer, so compare them on their own merits.\n\nCandidates:\n{candidates}\n\nLook across the candidates and decide which one is the best reply.\nBriefly explain WHY it\'s better than the others, then pick the winning\nslot label. Use "tie" only when no candidate is clearly better.\n';

/** Every shipped default, so an untouched prompt can be detected regardless
 * of which combo it was last defaulted to (hand-tuned prompts never match). */
export const ALL_DEFAULT_JUDGE_PROMPTS = [
  JUDGE_PROMPT_GOLDEN_INPUT,
  JUDGE_PROMPT_GOLDEN_NO_INPUT,
  JUDGE_PROMPT_NO_GOLDEN_INPUT,
  JUDGE_PROMPT_NO_GOLDEN_NO_INPUT,
] as const;

/** The default prompt for a given presence combo — the judge prompt adapts
 * to what the row actually gives it (a reference answer, task context, both,
 * or neither). Mirrors `_pick_default_select_best_prompt` in the Python evaluator. */
export function pickDefaultJudgePrompt({
  hasGolden,
  hasInput,
}: {
  hasGolden: boolean;
  hasInput: boolean;
}): string {
  if (hasGolden) {
    return hasInput ? JUDGE_PROMPT_GOLDEN_INPUT : JUDGE_PROMPT_GOLDEN_NO_INPUT;
  }
  return hasInput ? JUDGE_PROMPT_NO_GOLDEN_INPUT : JUDGE_PROMPT_NO_GOLDEN_NO_INPUT;
}
