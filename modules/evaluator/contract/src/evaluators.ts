/**
 * The evaluator catalogue a host renders and validates against: the langevals
 * definitions generated from the Python package, plus the ones this platform
 * runs itself.
 */
import { z } from "zod";

import type { EvaluatorCategory, EvaluatorDefinition } from "./evaluator.ts";
import {
  AVAILABLE_EVALUATORS as GENERATED_AVAILABLE_EVALUATORS,
  evaluatorsSchema as generatedEvaluatorsSchema,
} from "./evaluators.generated.ts";
import { NATIVE_EVALUATOR_DEFINITIONS, nativeEvaluatorsSchemaShape } from "./evaluators.native.ts";

export const evaluatorsSchema = generatedEvaluatorsSchema.extend(nativeEvaluatorsSchemaShape);
export type Evaluators = z.infer<typeof evaluatorsSchema>;
export type EvaluatorTypes = keyof Evaluators;
export type { EvaluatorDefinition, EvaluatorCategory };

export const AVAILABLE_EVALUATORS = {
  ...GENERATED_AVAILABLE_EVALUATORS,
  ...NATIVE_EVALUATOR_DEFINITIONS,
} as unknown as { [K in EvaluatorTypes]: EvaluatorDefinition };

/** Returns the installed catalogue definition when the check type is known. */
export const getEvaluatorDefinitions = (evaluatorType: string): EvaluatorDefinition | undefined =>
  AVAILABLE_EVALUATORS[evaluatorType as EvaluatorTypes];
