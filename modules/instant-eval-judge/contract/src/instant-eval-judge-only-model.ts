/**
 * Instant Evals answers evaluator judges only (ADR-174 decision 11), so every save that names a
 * model outside a judge refuses it here: one predicate, as a schema refinement or a service check.
 */

import { readHandledError } from "@langwatch/handled-error/read-handled-error";

import { INSTANT_EVAL_JUDGE_MODEL_ID } from "./instant-eval-judge.api.ts";
import {
  INSTANT_EVAL_JUDGE_ONLY_MESSAGE,
  InstantEvalJudgeOnlyModelError,
} from "./instant-eval-judge.errors.ts";

/** Whether a model id names Instant Evals, which answers evaluator judges only. */
export function isInstantEvalJudgeModel(model: string): boolean {
  return model === INSTANT_EVAL_JUDGE_MODEL_ID;
}

/** Spread into `.refine(...)` on a model id schema. */
export const refuseInstantEvalJudgeModel = [
  (model: string) => !isInstantEvalJudgeModel(model),
  { message: INSTANT_EVAL_JUDGE_ONLY_MESSAGE },
] as const;

/** For a save whose input schema is shared with reads: refuse in the service, before storing. */
export function assertNotInstantEvalJudgeModel({
  model,
}: {
  model: string | null | undefined;
}): void {
  if (model && isInstantEvalJudgeModel(model)) {
    throw new InstantEvalJudgeOnlyModelError();
  }
}

/** Whether a failed save was this refusal, so a screen can let its copy name the place. */
export function isInstantEvalJudgeOnlyRefusal(error: unknown): boolean {
  return readHandledError(error)?.code === "instant_eval_judge_only_model";
}
