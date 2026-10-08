/**
 * Instant Evals answers LLM judges only (ADR-174 decision 11). An evaluator of any other type
 * naming it as its model would fail at run time on the gateway, so every save that stores one
 * refuses it first: the evaluator itself, a Studio evaluator node and a workbench column.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import {
  InstantEvalJudgeOnlyModelError,
  instantEvalJudgeOnlyPlace,
  isInstantEvalJudgeModel,
} from "@langwatch/instant-eval-judge-contract";

import { isLlmJudgeEvaluator } from "./evaluators.ts";

type Loose = Record<string, unknown>;

const isLoose = (value: unknown): value is Loose =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether a model, of any shape, sits on Instant Evals under a known type that is not a judge. */
export function isInstantEvalOutsideJudge({
  evaluatorType,
  model,
}: {
  evaluatorType: unknown;
  model: unknown;
}): boolean {
  return (
    typeof evaluatorType === "string" &&
    typeof model === "string" &&
    isInstantEvalJudgeModel(model) &&
    !isLlmJudgeEvaluator(evaluatorType)
  );
}

/**
 * Refuses an evaluator config, of any shape, before it is stored, naming the evaluator. An
 * update's config may leave its type out; the stored config then answers for it.
 */
export function assertInstantEvalOnlyOnJudgeEvaluator({
  name,
  config,
  storedConfig,
}: {
  name: string;
  config: unknown;
  storedConfig?: unknown;
}): void {
  if (!isLoose(config)) return;
  const evaluatorType =
    config.evaluatorType ?? (isLoose(storedConfig) ? storedConfig.evaluatorType : undefined);
  const model = isLoose(config.settings) ? config.settings.model : undefined;
  if (!isInstantEvalOutsideJudge({ evaluatorType, model })) return;
  throw new InstantEvalJudgeOnlyModelError({
    places: [instantEvalJudgeOnlyPlace({ kind: "evaluator", name })],
  });
}
