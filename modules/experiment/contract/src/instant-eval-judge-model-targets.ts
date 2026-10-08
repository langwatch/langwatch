/**
 * Instant Evals answers evaluator judges only (ADR-174 decision 11). A workbench target that
 * calls a model runs on the gateway, never the judge, so a workbench naming Instant Evals on one
 * is refused. Evaluator columns and evaluator targets keep it: the judge answers them.
 */

import {
  InstantEvalJudgeOnlyModelError,
  isInstantEvalJudgeModel,
} from "@langwatch/instant-eval-judge-contract";

type Loose = Record<string, unknown>;

const isLoose = (value: unknown): value is Loose =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const draftModelOf = (target: Loose): unknown => {
  const draft = target.localPromptConfig;
  return isLoose(draft) && isLoose(draft.llm) ? draft.llm.model : undefined;
};

/** The targets of a workbench state, of any shape, calling a model on Instant Evals, by column. */
export function instantEvalJudgeModelTargetsOf({ state }: { state: unknown }): string[] {
  const targets = isLoose(state) && Array.isArray(state.targets) ? state.targets : [];
  return targets.flatMap((target, index) => {
    if (!isLoose(target) || target.type === "evaluator") return [];
    const model = draftModelOf(target);
    return typeof model === "string" && isInstantEvalJudgeModel(model)
      ? [`target ${index + 1}`]
      : [];
  });
}

/** Refuses a workbench state before it is stored, naming each target to change. */
export function assertNoInstantEvalJudgeModelTargets({ state }: { state: unknown }): void {
  const places = instantEvalJudgeModelTargetsOf({ state });
  if (places.length > 0) throw new InstantEvalJudgeOnlyModelError({ places });
}
