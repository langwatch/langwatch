import { AVAILABLE_EVALUATORS } from "@langwatch/evaluator-contract";
import { z } from "zod";

const evaluationEnvironmentValueSchema = z.string().optional();
const EVALUATOR_NATIVE_SWITCHES = ["LANGWATCH_ENABLE_PRESIDIO", "LANGWATCH_ENABLE_LINGUA"] as const;

/**
 * Narrows ambient boot input to the variables Evaluation is allowed to pass to
 * installed evaluators. Feature code receives this parsed value and never
 * reads the process environment.
 */
export function resolveWorkerEvaluationEnvironment(
  source: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string | undefined>> {
  const names = new Set<string>([
    ...EVALUATOR_NATIVE_SWITCHES,
    ...Object.values(AVAILABLE_EVALUATORS).flatMap((evaluator) => evaluator.envVars ?? []),
  ]);

  return Object.fromEntries(
    [...names].map((name) => [name, evaluationEnvironmentValueSchema.parse(source[name])]),
  );
}
