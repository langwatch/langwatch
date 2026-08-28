import { Config, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

const langevalsRuntimeConfigDefinition = RuntimeConfig.define({
  endpoint: Config.value(z.string().optional(), { env: "LANGEVALS_ENDPOINT" }),
  payload: {
    stagingThresholdBytes: Config.value(z.coerce.number().int().positive().optional(), {
      env: "LANGEVALS_STAGING_THRESHOLD_BYTES",
    }),
    stagingTtlSeconds: Config.value(z.coerce.number().int().positive().default(600), {
      env: "LANGEVALS_STAGING_TTL_SECONDS",
    }),
    evaluationMaxPayloadBytes: Config.value(
      z.coerce.number().int().positive().default(16_000_000),
      {
        env: "EVAL_MAX_PAYLOAD_BYTES",
      },
    ),
    topicClusteringMaxPayloadBytes: Config.value(
      z.coerce.number().int().positive().default(180_000_000),
      { env: "TOPIC_CLUSTERING_MAX_PAYLOAD_BYTES" },
    ),
  },
});

type LangevalsConfiguration = ConfigValue<typeof langevalsRuntimeConfigDefinition>;

/** Immutable process configuration for the Langevals HTTP evaluator transport. */
export type LangevalsRuntimeConfig = Readonly<{
  endpoint: string | undefined;
  maxRetries: number;
  timeoutMs: number;
  payload: LangevalsConfiguration["payload"];
}>;

const defaultMaxRetries = 1;
const defaultTimeoutMs = 120_000;

/**
 * Reads the validated process environment once, before the application graph
 * is composed. Endpoint syntax and an empty value deliberately retain the
 * legacy semantics: deployments may use an internal hostname, and an empty
 * endpoint leaves the transport unavailable.
 */
export function resolveLangevalsRuntimeConfig(
  source: Readonly<Record<string, unknown>>,
): LangevalsRuntimeConfig {
  const configuration = RuntimeConfig.create({
    name: "Langevals",
    definition: langevalsRuntimeConfigDefinition,
    source,
  }).value;

  return {
    endpoint: configuration.endpoint,
    maxRetries: defaultMaxRetries,
    timeoutMs: defaultTimeoutMs,
    payload: configuration.payload,
  };
}
