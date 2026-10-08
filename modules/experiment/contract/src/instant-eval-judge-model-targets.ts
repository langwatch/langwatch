/**
 * Instant Evals answers LLM judges only (ADR-174 decision 11). A workbench target that calls a
 * model, or an evaluator column that is not a judge, runs on the gateway, so a workbench naming
 * Instant Evals on one is refused. Judge columns and evaluator targets keep it.
 */

import { isInstantEvalOutsideJudge } from "@langwatch/evaluator-contract";
import {
  InstantEvalJudgeOnlyModelError,
  instantEvalJudgeOnlyPlace,
  isInstantEvalJudgeModel,
} from "@langwatch/instant-eval-judge-contract";

type Loose = Record<string, unknown>;

const isLoose = (value: unknown): value is Loose =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const draftModelOf = (target: Loose): unknown => {
  const draft = target.localPromptConfig;
  return isLoose(draft) && isLoose(draft.llm) ? draft.llm.model : undefined;
};

const settingsModelOf = (settings: unknown): unknown =>
  isLoose(settings) ? settings.model : undefined;

/** An evaluator column's place: its unsaved name, or else its position. */
const columnPlaceOf = (column: Loose, index: number): string => {
  const draft = column.localEvaluatorConfig;
  const name = isLoose(draft) && typeof draft.name === "string" ? draft.name : "";
  return name ? instantEvalJudgeOnlyPlace({ kind: "evaluator", name }) : `evaluator ${index + 1}`;
};

/** The evaluator columns, of any shape, on Instant Evals outside a judge, in either settings. */
const columnsOutsideJudgeOf = (state: unknown): string[] => {
  const columns = isLoose(state) && Array.isArray(state.evaluators) ? state.evaluators : [];
  return columns.flatMap((column, index) => {
    if (!isLoose(column)) return [];
    const draft = column.localEvaluatorConfig;
    const models = [
      settingsModelOf(column.settings),
      isLoose(draft) ? settingsModelOf(draft.settings) : undefined,
    ];
    const outsideJudge = models.some((model) =>
      isInstantEvalOutsideJudge({ evaluatorType: column.evaluatorType, model }),
    );
    return outsideJudge ? [columnPlaceOf(column, index)] : [];
  });
};

/** What in a workbench state, of any shape, is on Instant Evals outside a judge: columns first. */
export function instantEvalJudgeModelTargetsOf({ state }: { state: unknown }): string[] {
  const targets = isLoose(state) && Array.isArray(state.targets) ? state.targets : [];
  const targetPlaces = targets.flatMap((target, index) => {
    if (!isLoose(target) || target.type === "evaluator") return [];
    const model = draftModelOf(target);
    return typeof model === "string" && isInstantEvalJudgeModel(model)
      ? [`target ${index + 1}`]
      : [];
  });
  return [...columnsOutsideJudgeOf(state), ...targetPlaces];
}

/** Refuses a workbench state before it is stored, naming each column and target to change. */
export function assertNoInstantEvalJudgeModelTargets({ state }: { state: unknown }): void {
  const places = instantEvalJudgeModelTargetsOf({ state });
  if (places.length > 0) throw new InstantEvalJudgeOnlyModelError({ places });
}
