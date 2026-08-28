import {
  Config,
  resolveTelemetryConfiguration,
  RuntimeConfig,
  type ConfigValue,
  type TelemetryConfig,
} from "@langwatch/config";
import type { LoggerConfiguration } from "@langwatch/observability";
import { z } from "zod";
import { resolveLegacyLoggerConfiguration } from "./logger.config";

/**
 * The private configuration needed before an executable evaluates the legacy
 * application graph. Each entrypoint resolves this once after its environment
 * source has loaded, then passes only the relevant semantic values onward.
 */
const processBootstrapDefinition = RuntimeConfig.define({
  nodeEnv: Config.value(z.enum(["development", "test", "production"]), { env: "NODE_ENV" }),
  environment: Config.value(
    z
      .string()
      .optional()
      .transform((value) => value ?? "local"),
    { env: "ENVIRONMENT" },
  ),
});

type ProcessBootstrapValues = ConfigValue<typeof processBootstrapDefinition>;

export type ProcessBootstrapConfig = Readonly<{
  nodeEnv: ProcessBootstrapValues["nodeEnv"];
  environment: ProcessBootstrapValues["environment"];
  logger: LoggerConfiguration;
  telemetry: TelemetryConfig;
}>;

export function resolveProcessBootstrapConfig(
  source: Readonly<Record<string, unknown>>,
): ProcessBootstrapConfig {
  const values = RuntimeConfig.create({
    name: "platform process bootstrap",
    definition: processBootstrapDefinition,
    source,
  }).value;

  return {
    nodeEnv: values.nodeEnv,
    environment: values.environment,
    logger: resolveLegacyLoggerConfiguration(source),
    telemetry: resolveTelemetryConfiguration(source),
  };
}
