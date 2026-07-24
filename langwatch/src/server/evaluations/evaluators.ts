// The evaluator catalog every consumer imports. It merges the generated
// langevals catalog (`evaluators.generated.ts`, refreshed by the copy script on
// `start:prepare:files`) with the hand-written native evaluators
// (`evaluators.native.ts`). Importing this facade instead of the generated file
// means a native evaluator is part of the `EvaluatorTypes` union everywhere, so
// the exhaustive category map forces it a UI category and the settings form
// renders it from the merged Zod schema.
//
// Pure (Zod + types only); the native executors live in `native/` and are
// reached from the dispatchers, never from this file.
import type { z } from "zod";
import {
  AVAILABLE_EVALUATORS as GENERATED_AVAILABLE_EVALUATORS,
  evaluatorsSchema as generatedEvaluatorsSchema,
} from "./evaluators.generated";
import {
  NATIVE_EVALUATOR_DEFINITIONS,
  nativeEvaluatorsSchemaShape,
} from "./evaluators.native";

export const evaluatorsSchema = generatedEvaluatorsSchema.extend(
  nativeEvaluatorsSchemaShape,
);

export type Evaluators = z.infer<typeof evaluatorsSchema>;
export type EvaluatorTypes = keyof Evaluators;

export type EvaluatorDefinition<T extends EvaluatorTypes> = {
  name: string;
  description: string;
  category:
    | "quality"
    | "rag"
    | "safety"
    | "policy"
    | "other"
    | "custom"
    | "similarity";
  docsUrl?: string;
  isGuardrail: boolean;
  requiredFields: string[];
  optionalFields: string[];
  settings: {
    [K in keyof Evaluators[T]["settings"]]: {
      description?: string;
      default: Evaluators[T]["settings"][K];
    };
  };
  envVars: string[];
  result: {
    score?: { description: string };
    passed?: { description: string };
    label?: { description: string };
  };
};

export const AVAILABLE_EVALUATORS = {
  ...GENERATED_AVAILABLE_EVALUATORS,
  ...NATIVE_EVALUATOR_DEFINITIONS,
} as unknown as {
  [K in EvaluatorTypes]: EvaluatorDefinition<K>;
};

export type {
  BatchEvaluationResult,
  EvaluationResult,
  EvaluationResultError,
  EvaluationResultSkipped,
  Money,
  SingleEvaluationResult,
} from "./evaluators.generated";
export {
  batchEvaluationResultSchema,
  evaluationResultErrorSchema,
  evaluationResultSchema,
  evaluationResultSkippedSchema,
  evaluatorTypesSchema,
  moneySchema,
  singleEvaluationResultSchema,
} from "./evaluators.generated";
