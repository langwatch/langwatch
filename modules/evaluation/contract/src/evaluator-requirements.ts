/**
 * The evaluator a type names, built-in or one of the project's custom workflows,
 * as a pure rule both evaluation's evaluate doors and experiment's dataset door read. Callers
 * pass each custom workflow's required fields, from workflow-contract's getWorkflowsRequiredFields.
 */
import {
  AVAILABLE_EVALUATORS,
  EvaluatorNotFoundError,
  type CustomEvaluatorDefinition,
  type EvaluatorDefinition,
  type EvaluatorTypes,
} from "@langwatch/evaluator-contract";

export type EvaluatorIncludingCustom =
  | EvaluatorDefinition<keyof typeof AVAILABLE_EVALUATORS>
  | CustomEvaluatorDefinition;

/**
 * A built-in or project custom evaluator by type; throws `EvaluatorNotFoundError` when neither
 * has it.
 */
export const getEvaluatorIncludingCustom = ({
  checkType,
  customEvaluators,
}: {
  checkType: EvaluatorTypes;
  customEvaluators: readonly { id: string; name: string; requiredFields: string[] }[];
}): EvaluatorIncludingCustom => {
  const customEntries = customEvaluators.map(
    ({ id, name, requiredFields }): [string, CustomEvaluatorDefinition] => [
      `custom/${id}`,
      { name, requiredFields },
    ],
  );

  const availableEvaluators: Record<string, EvaluatorIncludingCustom | undefined> = {
    ...AVAILABLE_EVALUATORS,
    ...Object.fromEntries(customEntries),
  };

  const evaluator = availableEvaluators[checkType];
  if (!evaluator) throw new EvaluatorNotFoundError(checkType);
  return evaluator;
};
