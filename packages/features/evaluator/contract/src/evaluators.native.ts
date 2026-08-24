import { z } from "zod/v4";

export const API_KEYS_AND_SECRETS_DETECTION =
  "langwatch/api_keys_and_secrets_detection" as const;
export const nativeEvaluatorsSchemaShape = {
  [API_KEYS_AND_SECRETS_DETECTION]: z.object({ settings: z.object({}) }),
};
export const NATIVE_EVALUATOR_DEFINITIONS = {
  [API_KEYS_AND_SECRETS_DETECTION]: {
    name: "API Keys & Secrets Detection",
    description: "Flags leaked credentials in trace content.",
    category: "safety",
    docsUrl: undefined,
    isGuardrail: true,
    requiredFields: [],
    optionalFields: ["input", "output"],
    settings: {},
    envVars: [],
    result: {
      score: { description: "Number of secrets detected; 0 means none were found" },
      passed: { description: "True when no secret was detected" },
    },
  },
} as const;
export const NATIVE_EVALUATOR_TYPES = Object.keys(NATIVE_EVALUATOR_DEFINITIONS);
export const isNativeEvaluatorType = (value: string): boolean =>
  NATIVE_EVALUATOR_TYPES.includes(value);
