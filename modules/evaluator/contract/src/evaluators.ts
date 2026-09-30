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
import {
  API_KEYS_AND_SECRETS_DETECTION,
  NATIVE_EVALUATOR_DEFINITIONS,
  nativeEvaluatorsSchemaShape,
} from "./evaluators.native.ts";

export const evaluatorsSchema = z.object({
  ...generatedEvaluatorsSchema.shape,
  ...nativeEvaluatorsSchemaShape,
});
export type Evaluators = z.infer<typeof evaluatorsSchema>;
export type EvaluatorTypes = keyof Evaluators;
export type { EvaluatorDefinition, EvaluatorCategory };

const nativeEvaluatorDefinitions = {
  [API_KEYS_AND_SECRETS_DETECTION]: {
    ...NATIVE_EVALUATOR_DEFINITIONS[API_KEYS_AND_SECRETS_DETECTION],
    requiredFields: [
      ...NATIVE_EVALUATOR_DEFINITIONS[API_KEYS_AND_SECRETS_DETECTION].requiredFields,
    ],
    optionalFields: [
      ...NATIVE_EVALUATOR_DEFINITIONS[API_KEYS_AND_SECRETS_DETECTION].optionalFields,
    ],
    settings: { ...NATIVE_EVALUATOR_DEFINITIONS[API_KEYS_AND_SECRETS_DETECTION].settings },
    envVars: [...NATIVE_EVALUATOR_DEFINITIONS[API_KEYS_AND_SECRETS_DETECTION].envVars],
  },
} satisfies Record<string, EvaluatorDefinition>;

export const AVAILABLE_EVALUATORS: Readonly<Record<string, EvaluatorDefinition>> = {
  ...GENERATED_AVAILABLE_EVALUATORS,
  ...nativeEvaluatorDefinitions,
};

/** The installed catalogue definition for a check type: one, or none when the type is unknown. */
export const findEvaluatorDefinitions = (evaluatorType: string): EvaluatorDefinition[] => {
  const definitions: Readonly<Record<string, EvaluatorDefinition>> = AVAILABLE_EVALUATORS;
  const definition = definitions[evaluatorType];

  return definition ? [definition] : [];
};

/**
 * The prompt-driven LLM judges: they answer a free-form question about the
 * content, so by default they read the whole trace or thread, tool calls and
 * results included, rather than its first input and last output.
 * @see specs/evaluators/judges-read-tool-evidence.feature
 */
export const LLM_JUDGE_EVALUATOR_TYPES = [
  "langevals/llm_boolean",
  "langevals/llm_score",
  "langevals/llm_category",
] as const;

export const isLlmJudgeEvaluator = (evaluatorType: string): boolean =>
  (LLM_JUDGE_EVALUATOR_TYPES as readonly string[]).includes(evaluatorType);
