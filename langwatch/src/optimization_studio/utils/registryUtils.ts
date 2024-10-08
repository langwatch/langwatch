import { evaluatorTempNameMap } from "../../components/checks/EvaluatorSelection";
import type { AVAILABLE_EVALUATORS } from "../../server/evaluations/evaluators.generated";
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
    .map(([evaluator, definition]) => {
      let inputs: Field[] = [];
      const outputs: Field[] = [];

      // Add required fields
      definition.requiredFields.forEach((field) => {
        inputs.push({
          identifier: field,
          type: field === "contexts" ? "list[str]" : "str",
        });
      });

      // Add optional fields
      definition.optionalFields.forEach((field) => {
        inputs.push({
          identifier: field,
          type: field === "contexts" ? "list[str]" : "str",
          optional: true,
        });
      });

      const fieldsOrder = [
        "conversation",
        "input",
        "contexts",
        "output",
        "expected_output",
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
        evaluator,
        name: (evaluatorTempNameMap[definition.name] ?? definition.name)
          .replace("Evaluator", "")
          .trim(),
        inputs,
        outputs,
      } satisfies Evaluator;
    });
};
