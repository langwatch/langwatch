import { Config, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/**
 * Evaluator service endpoint. Absence composes no runtime and is not a boot
 * failure; it's a supported read-only shape. Env vars are registry data, not config.
 */
export const evaluationConfig = Config.define((c) => ({
  langevalsEndpoint: c.env("LANGEVALS_ENDPOINT", z.string().optional()),
}));

export type EvaluationServerConfig = ConfigOf<typeof evaluationConfig>;

/** All a browser learns: whether this deployment can run an evaluator at all. */
export const evaluationWebConfigSchema = z.strictObject({ langevals: z.boolean() });

export type EvaluationWebConfig = z.infer<typeof evaluationWebConfigSchema>;
