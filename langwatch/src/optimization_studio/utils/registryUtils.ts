import { evaluatorTempNameMap } from "../../components/checks/EvaluatorSelection";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "../../server/evaluations/evaluators.generated";
import type { Evaluator, Field } from "../types/dsl";

export const convertEvaluators = (
  evaluators: typeof AVAILABLE_EVALUATORS
): Evaluator[] => {
  return Object.entries(evaluators)
    .filter(([evaluator, definition]) => {
      if (
        definition.requiredFields.includes("conversation") ||
        definition.optionalFields.includes("conversation") ||
        evaluator.startsWith("example/")
      ) {
        return false;
      }
      return true;
    })
    .map(([evaluator]) =>
      buildEvaluatorFromType(evaluator as keyof typeof AVAILABLE_EVALUATORS)
    );
};

/**
 * Builds a full evaluator object from the evaluator type
 * @param evaluatorType - The evaluator to convert
 * @returns The evaluator object
 */
export const buildEvaluatorFromType = (
  evaluatorType: EvaluatorTypes
): Evaluator => {
  const definition = AVAILABLE_EVALUATORS[evaluatorType];

  let inputs: Field[] = [];
  const outputs: Field[] = [];

  // Add required fields
  definition.requiredFields.forEach((field) => {
    inputs.push({
      identifier: field,
      type:
        field === "contexts" || field === "expected_contexts"
          ? "list[str]"
          : "str",
    });
  });

  // Add optional fields
  definition.optionalFields.forEach((field) => {
    inputs.push({
      identifier: field,
      type:
        field === "contexts" || field === "expected_contexts"
          ? "list[str]"
          : "str",
      optional: true,
    });
  });

  const fieldsOrder = [
    "conversation",
    "input",
    "contexts",
    "output",
    "expected_output",
    "expected_contexts",
  ];
  inputs = inputs.sort(
    (a, b) =>
      fieldsOrder.indexOf(a.identifier) - fieldsOrder.indexOf(b.identifier)
  );

  // Add outputs based on the result object
  if (definition.result.score) {
    outputs.push({ identifier: "score", type: "float" });
  }
  if (definition.result.passed) {
    outputs.push({ identifier: "passed", type: "bool" });
  }
  if (definition.result.label) {
    outputs.push({ identifier: "label", type: "str" });
  }

  return {
    cls: "LangWatchEvaluator",
    evaluator: evaluatorType,
    name: (evaluatorTempNameMap[definition.name] ?? definition.name)
      .replace("Evaluator", "")
      .trim(),
    description: definition.description,
    inputs,
    outputs,
  } satisfies Evaluator;
};
