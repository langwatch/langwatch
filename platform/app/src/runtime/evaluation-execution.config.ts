import { Config, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

const evaluationExecutionConfigDefinition = RuntimeConfig.define({
  defaultConcurrency: Config.value(
    z
      .string()
      .optional()
      .transform((value) => Number.parseInt(value ?? "10", 10)),
    { env: "EVAL_V3_CONCURRENCY" },
  ),
});

export type EvaluationExecutionConfig = ConfigValue<typeof evaluationExecutionConfigDefinition>;

/** Parses the legacy evaluation limit once without changing its parseInt behaviour. */
export function resolveEvaluationExecutionConfig(
  source: Readonly<Record<string, unknown>>,
): EvaluationExecutionConfig {
  return RuntimeConfig.create({
    name: "evaluation execution",
    definition: evaluationExecutionConfigDefinition,
    source,
  }).value;
}
