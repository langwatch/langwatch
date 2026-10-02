import { AVAILABLE_EVALUATORS, type EvaluatorDefinition } from "@langwatch/evaluator-contract";

/** One of the project's workflow-backed evaluators, as the catalogue lists it. */
export type CustomEvaluatorSummary = {
  id: string;
  name: string;
  description: unknown;
  requiredFields: readonly (string | undefined)[];
};

/** The built-in evaluators plus the project's own, keyed `custom/<id>`. */
export function evaluatorCatalogueWith(
  customEvaluators: readonly CustomEvaluatorSummary[],
): Readonly<Record<string, EvaluatorDefinition>> {
  return {
    ...AVAILABLE_EVALUATORS,
    ...Object.fromEntries(
      customEvaluators.map((evaluator) => [`custom/${evaluator.id}`, customDefinition(evaluator)]),
    ),
  };
}

function customDefinition(evaluator: CustomEvaluatorSummary): EvaluatorDefinition {
  return {
    name: evaluator.name,
    description: typeof evaluator.description === "string" ? evaluator.description : "",
    category: "custom",
    isGuardrail: false,
    requiredFields: evaluator.requiredFields.filter((field) => field !== undefined),
    optionalFields: [],
    settings: {},
    result: {},
    envVars: [],
  };
}
