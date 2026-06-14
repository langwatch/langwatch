// Hand-written evaluators that execute natively in TypeScript instead of being
// dispatched to the Python langevals service. They are merged with the
// generated langevals catalog in `evaluators.ts` (the facade every consumer
// imports), so they look and behave like any other built-in evaluator: a Zod
// settings schema renders the form, the type flows into the exhaustive category
// map, and the dispatcher routes them to an in-process executor.
//
// This file is PURE (Zod + literals only) so the facade stays safe to import
// from the client bundle; the executors live in `native/` (server-only).
import { z } from "zod";

/** Evaluator key for the native API-keys-and-secrets detector. */
export const API_KEYS_AND_SECRETS_DETECTION =
  "langwatch/api_keys_and_secrets_detection";

/**
 * The Zod schema fragment merged into the generated `evaluatorsSchema`. Each
 * entry mirrors the generated shape: `{ settings: z.object({...}) }`. The
 * secrets detector needs no configuration — it flags every built-in credential
 * type — so its settings are empty.
 */
export const nativeEvaluatorsSchemaShape = {
  [API_KEYS_AND_SECRETS_DETECTION]: z.object({
    settings: z.object({}),
  }),
};

/**
 * Catalog entries merged into the generated `AVAILABLE_EVALUATORS`. Structurally
 * an `EvaluatorDefinition` for each native key; the facade applies the precise
 * type when it merges.
 */
export const NATIVE_EVALUATOR_DEFINITIONS = {
  [API_KEYS_AND_SECRETS_DETECTION]: {
    name: "API Keys & Secrets Detection",
    description:
      "Flags leaked credentials in trace content: provider and cloud API keys, tokens, private keys, and database connection strings. A secret that privacy redaction already scrubbed at ingestion is still flagged.",
    category: "safety",
    docsUrl: undefined,
    isGuardrail: true,
    requiredFields: [],
    optionalFields: ["input", "output"],
    settings: {},
    envVars: [],
    result: {
      score: {
        description: "Number of secrets detected; 0 means none were found",
      },
      passed: {
        description:
          "True when no secret was detected, false when at least one was",
      },
    },
  },
} as const;

/** Every native evaluator key, for the dispatch-time type guard. */
export const NATIVE_EVALUATOR_TYPES = Object.keys(
  NATIVE_EVALUATOR_DEFINITIONS,
) as (keyof typeof NATIVE_EVALUATOR_DEFINITIONS)[];

export function isNativeEvaluatorType(type: string): boolean {
  return (NATIVE_EVALUATOR_TYPES as string[]).includes(type);
}
