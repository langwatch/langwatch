import {
  AVAILABLE_EVALUATORS,
  type EvaluatorDefinition,
  type EvaluatorTypes,
  type Evaluators,
} from "./evaluators.generated";

export const getEvaluatorDefinitions = (evaluator: string) => {
  for (const [key, val] of Object.entries(AVAILABLE_EVALUATORS)) {
    if (key === evaluator) return val;
  }
  return undefined;
};

export const getEvaluatorDefaultSettings = <T extends EvaluatorTypes>(
  evaluator: EvaluatorDefinition<T>
) => {
  return Object.fromEntries(
    Object.entries(evaluator.settings).map(([key, setting]) => {
      return [key, (setting as any).default];
    })
  ) as Evaluators[T]["settings"];
};
