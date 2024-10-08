import { evaluatorTempNameMap } from "../../components/checks/EvaluatorSelection";
import type { AVAILABLE_EVALUATORS } from "../../server/evaluations/evaluators.generated";
import type { Evaluator, Field } from "../types/dsl";

export const convertEvaluators = (
  evaluators: typeof AVAILABLE_EVALUATORS
): Evaluator[] => {
  return Object.entries(evaluators)
    .filter(([cls, evaluator]) => {
      if (
        evaluator.requiredFields.includes("conversation") ||
        evaluator.optionalFields.includes("conversation") ||
        cls.startsWith("example/")
      ) {
        return false;
      }
      return true;
    })
    .map(([cls, evaluator]) => {
      const inputs: Field[] = [];
      const outputs: Field[] = [];

      // Add required fields
      evaluator.requiredFields.forEach((field) => {
        inputs.push({
          identifier: field,
          type: field === "contexts" ? "list[str]" : "str",
        });
      });

      // Add optional fields
      evaluator.optionalFields.forEach((field) => {
        inputs.push({
          identifier: field,
          type: field === "contexts" ? "list[str]" : "str",
          optional: true,
        });
      });

      // Add outputs based on the result object
      if (evaluator.result.score) {
        outputs.push({ identifier: "score", type: "float" });
      }
      if (evaluator.result.passed) {
        outputs.push({ identifier: "passed", type: "bool" });
      }
      if (evaluator.result.label) {
        outputs.push({ identifier: "label", type: "str" });
      }

      return {
        cls,
        name: (evaluatorTempNameMap[evaluator.name] ?? evaluator.name)
          .replace("Evaluator", "")
          .trim(),
        inputs,
        outputs,
      } satisfies Evaluator;
    });
};
