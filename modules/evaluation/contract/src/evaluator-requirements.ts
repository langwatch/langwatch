/**
 * The evaluator a type names, built-in or one of the project's custom workflows,
 * as a pure rule both evaluation's evaluate doors and experiment's dataset door read.
 */
import {
  AVAILABLE_EVALUATORS,
  EvaluatorNotFoundError,
  type CustomEvaluatorDefinition,
  type EvaluatorDefinition,
  type EvaluatorTypes,
} from "@langwatch/evaluator-contract";
import { getInputsOutputs, type StudioEdge, type StudioNode } from "@langwatch/workflow-contract";

import type { CustomEvaluator } from "./evaluation-trpc.schemas.ts";

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
  customEvaluators: readonly CustomEvaluator[];
}): EvaluatorIncludingCustom => {
  const customEntries: [string, CustomEvaluatorDefinition][] = [];

  for (const evaluator of customEvaluators) {
    const dsl = evaluator.versions[0]?.dsl;

    if (!dsl) continue;

    const cloned = JSON.parse(JSON.stringify(dsl)) as
      | { edges?: StudioEdge[]; nodes?: StudioNode[] }
      | undefined;
    const { inputs } = getInputsOutputs(cloned?.edges ?? [], cloned?.nodes ?? []);
    const requiredFields = inputs
      .map((input) => input.identifier)
      .filter((id): id is string => typeof id === "string");

    customEntries.push([`custom/${evaluator.id}`, { name: evaluator.name, requiredFields }]);
  }

  const availableEvaluators: Record<string, EvaluatorIncludingCustom | undefined> = {
    ...AVAILABLE_EVALUATORS,
    ...Object.fromEntries(customEntries),
  };

  const evaluator = availableEvaluators[checkType];
  if (!evaluator) throw new EvaluatorNotFoundError(checkType);
  return evaluator;
};
