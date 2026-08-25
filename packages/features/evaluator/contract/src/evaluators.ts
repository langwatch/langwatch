import type { z } from "zod/v4";
import {
  AVAILABLE_EVALUATORS as GENERATED_AVAILABLE_EVALUATORS,
  evaluatorsSchema as generatedEvaluatorsSchema,
} from "./evaluators.generated";
import {
  NATIVE_EVALUATOR_DEFINITIONS,
  nativeEvaluatorsSchemaShape,
} from "./evaluators.native";
import type { EvaluatorDefinition, EvaluatorCategory } from "./evaluator";

export const evaluatorsSchema = generatedEvaluatorsSchema.extend(nativeEvaluatorsSchemaShape);
export type Evaluators = z.infer<typeof evaluatorsSchema>;
export type EvaluatorTypes = keyof Evaluators;
export type { EvaluatorDefinition, EvaluatorCategory };

export const AVAILABLE_EVALUATORS = {
  ...GENERATED_AVAILABLE_EVALUATORS,
  ...NATIVE_EVALUATOR_DEFINITIONS,
} as unknown as { [K in EvaluatorTypes]: EvaluatorDefinition };

/** Returns the installed catalogue definition when the check type is known. */
export const getEvaluatorDefinitions = (
  evaluatorType: string,
): EvaluatorDefinition | undefined =>
  AVAILABLE_EVALUATORS[evaluatorType as EvaluatorTypes];
