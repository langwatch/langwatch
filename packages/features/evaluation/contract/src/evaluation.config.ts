import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * Where the evaluator service answers.
 *
 * Absent composes no evaluator runtime at all, which is a supported
 * read-only shape, so absence is not a boot failure. Which environment
 * variables a given evaluator needs is registry data, not configuration: the
 * process answers "is this one set" over its own environment rather than
 * enumerating names no schema could know in advance.
 */
export const evaluationServerConfigDefinition = RuntimeConfig.define({
  langevalsEndpoint: Config.value(z.string().optional(), { env: "LANGEVALS_ENDPOINT" }),
});

export type EvaluationServerConfig = ConfigValue<typeof evaluationServerConfigDefinition>;

export const evaluationServerConfigSchema = compileRuntimeConfig(evaluationServerConfigDefinition);

/** All a browser learns: whether this deployment can run an evaluator at all. */
export const evaluationWebConfigSchema = z.strictObject({ langevals: z.boolean() });

export type EvaluationWebConfig = z.infer<typeof evaluationWebConfigSchema>;
