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

export const API_KEYS_AND_SECRETS_DETECTION = "langwatch/api_keys_and_secrets_detection" as const;

const nativeEvaluatorsSchemaShape = {
  [API_KEYS_AND_SECRETS_DETECTION]: z.object({ settings: z.object({}) }),
};

/** The evaluators this platform runs itself, in the shape langevals publishes. */
export const NATIVE_EVALUATOR_DEFINITIONS = {
  [API_KEYS_AND_SECRETS_DETECTION]: {
    name: "API Keys & Secrets Detection",
    description:
      "Flags leaked credentials in trace content: provider and cloud API keys, tokens, private keys, and database connection strings. A secret already scrubbed by privacy redaction is still flagged.",
    category: "safety",
    docsUrl: undefined,
    isGuardrail: true,
    requiredFields: [],
    optionalFields: ["input", "output"],
    settings: {},
    envVars: [],
    result: {
      score: { description: "Number of secrets detected; 0 means none were found" },
      passed: {
        description: "True when no secret was detected, false when at least one was",
      },
    },
  },
} as const;

export const NATIVE_EVALUATOR_TYPES = Object.keys(NATIVE_EVALUATOR_DEFINITIONS);

export const isNativeEvaluatorType = (value: string): boolean =>
  NATIVE_EVALUATOR_TYPES.includes(value);

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
