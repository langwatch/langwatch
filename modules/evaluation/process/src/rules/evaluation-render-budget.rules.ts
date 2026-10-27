import { pickModelMetadata } from "@langwatch/model-provider-contract";

/** The judge's own default for its max tokens setting (langevals DEFAULT_MAX_TOKENS). */
const JUDGE_DEFAULT_MAX_TOKENS = 128_000;

/** Left for the judge's answer inside the model's window (langevals ANSWER_RESERVE_TOKENS). */
const ANSWER_RESERVE_TOKENS = 8_192;

/**
 * The render budget counts bytes/4; a JSON-dense tool result tokenises at
 * about twice that, so half the judge's budget always fits its real count.
 */
const ESTIMATE_SAFETY_RATIO = 0.5;

const MIN_RENDER_TOKENS = 2_000;

/**
 * The tokens a trace or thread is rendered under for a judge: the evaluator's
 * max tokens setting, capped by its model's window when the catalogue knows
 * it. The judge's own cut keeping both ends is only the backstop.
 * @see specs/evaluators/judges-read-tool-evidence.feature
 */
export function evaluationRenderBudget({
  settings,
}: {
  settings: Record<string, unknown> | undefined;
}): number {
  const setting = settings?.max_tokens;
  const maxTokens =
    typeof setting === "number" && Number.isFinite(setting) && setting > 0
      ? setting
      : JUDGE_DEFAULT_MAX_TOKENS;
  const model = settings?.model;
  const window = typeof model === "string" ? pickModelMetadata(model)?.contextLength : undefined;
  const judgeBudget =
    window === undefined
      ? maxTokens
      : Math.min(
          maxTokens,
          window > ANSWER_RESERVE_TOKENS * 2 ? window - ANSWER_RESERVE_TOKENS : window / 2,
        );
  return Math.max(MIN_RENDER_TOKENS, Math.floor(judgeBudget * ESTIMATE_SAFETY_RATIO));
}
