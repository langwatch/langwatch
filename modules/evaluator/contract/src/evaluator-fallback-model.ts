/**
 * The chat model a new evaluator starts on when the project resolves no default: Instant
 * Evals for an LLM judge in a released project with no usable model provider, which could
 * run nothing else, and the platform default otherwise. The create form and the API share it.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { INSTANT_EVAL_JUDGE_MODEL_ID } from "@langwatch/instant-eval-judge-contract";

import { isLlmJudgeEvaluator } from "./evaluators.ts";

export function evaluatorFallbackModel<PlatformDefault extends string | null>({
  evaluatorType,
  released,
  hasUsableProvider,
  platformDefault,
}: {
  evaluatorType: string | undefined;
  released: boolean;
  hasUsableProvider: boolean;
  platformDefault: PlatformDefault;
}): string | PlatformDefault {
  const startsOnInstantEvals =
    !!evaluatorType && isLlmJudgeEvaluator(evaluatorType) && released && !hasUsableProvider;
  return startsOnInstantEvals ? INSTANT_EVAL_JUDGE_MODEL_ID : platformDefault;
}
