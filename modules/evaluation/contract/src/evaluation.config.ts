import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

/**
 * Evaluator service endpoint. Absence composes no runtime and is not a boot
 * failure; it's a supported read-only shape. Env vars are registry data, not config.
 */
export const evaluationServerConfigDefinition = RuntimeConfig.define({
  langevalsEndpoint: Config.value(z.string().optional(), { env: "LANGEVALS_ENDPOINT" }),
});

export type EvaluationServerConfig = ConfigValue<typeof evaluationServerConfigDefinition>;

export const evaluationServerConfigSchema = compileRuntimeConfig(evaluationServerConfigDefinition);

/** All a browser learns: whether this deployment can run an evaluator at all. */
export const evaluationWebConfigSchema = z.strictObject({ langevals: z.boolean() });

export type EvaluationWebConfig = z.infer<typeof evaluationWebConfigSchema>;
