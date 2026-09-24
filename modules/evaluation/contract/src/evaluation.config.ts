import { Config, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

const positiveInteger = z.coerce.number().int().positive();

/**
 * The langevals boundary this module owns (ARCHITECTURE §3.3): its endpoint,
 * the staging of oversized payloads, their hard caps, and the evaluator
 * switches the catalogue reports on. Absence of the endpoint composes no runtime.
 */
export const evaluationConfig = Config.define((c) => ({
  langevalsEndpoint: c.env("LANGEVALS_ENDPOINT", z.string().optional()),
  /** Unset keeps every payload inline: only a Lambda-fronted langevals has a body cap to dodge. */
  stagingThresholdBytes: c.env("LANGEVALS_STAGING_THRESHOLD_BYTES", positiveInteger.optional()),
  stagingTtlSeconds: c.env("LANGEVALS_STAGING_TTL_SECONDS", positiveInteger.default(600)),
  evaluationMaxPayloadBytes: c.env("EVAL_MAX_PAYLOAD_BYTES", positiveInteger.default(16_000_000)),
  topicClusteringMaxPayloadBytes: c.env(
    "TOPIC_CLUSTERING_MAX_PAYLOAD_BYTES",
    positiveInteger.default(180_000_000),
  ),
  azureContentSafetyEndpoint: c.env("AZURE_CONTENT_SAFETY_ENDPOINT", z.string().optional()),
  enablePresidio: c.env("LANGWATCH_ENABLE_PRESIDIO", z.string().optional()),
  enableLingua: c.env("LANGWATCH_ENABLE_LINGUA", z.string().optional()),
}));

export type EvaluationServerConfig = ConfigOf<typeof evaluationConfig>;

/** All a browser learns: whether this deployment can run an evaluator at all. */
export const evaluationWebConfigSchema = z.strictObject({ langevals: z.boolean() });

export type EvaluationWebConfig = z.infer<typeof evaluationWebConfigSchema>;
