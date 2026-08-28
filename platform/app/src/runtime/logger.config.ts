import { Config, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import type { LoggerConfiguration } from "@langwatch/observability";
import { z } from "zod";

const optionalString = z.string().optional();

const legacyLoggerConfigDefinition = RuntimeConfig.define({
  environment: Config.value(optionalString, { env: "NODE_ENV" }),
  format: Config.value(optionalString, { env: "LOG_FORMAT" }),
  pinoLevel: Config.value(optionalString, { env: "PINO_LOG_LEVEL" }),
  legacyLevel: Config.value(optionalString, { env: "_LOG_LEVEL" }),
  pinoOtelEnabled: Config.value(optionalString, { env: "PINO_OTEL_ENABLED" }),
  consoleLevel: Config.value(optionalString, { env: "LOG_CONSOLE_LEVEL" }),
  legacyConsoleLevel: Config.value(optionalString, { env: "PINO_CONSOLE_LEVEL" }),
  otelLevel: Config.value(optionalString, { env: "LOG_OTEL_LEVEL" }),
  legacyOtelLevel: Config.value(optionalString, { env: "PINO_OTEL_LEVEL" }),
  serviceName: Config.value(optionalString, { env: "OTEL_SERVICE_NAME" }),
  serviceVersion: Config.value(optionalString, { env: "SERVICE_VERSION" }),
  resourceAttributes: Config.value(optionalString, { env: "OTEL_RESOURCE_ATTRIBUTES" }),
  deploymentEnvironment: Config.value(optionalString, { env: "ENVIRONMENT" }),
  transportServiceVersion: Config.value(optionalString, { env: "npm_package_version" }),
});

type LegacyLoggerConfig = ConfigValue<typeof legacyLoggerConfigDefinition>;

/**
 * Maps validated legacy process variables to the semantic logger configuration.
 * The logger package receives only these typed values and never reads env.
 */
export function resolveLegacyLoggerConfiguration(
  source: Readonly<Record<string, unknown>>,
): LoggerConfiguration {
  const config = RuntimeConfig.create({
    name: "legacy logger",
    definition: legacyLoggerConfigDefinition,
    source,
  }).value;

  return {
    environment: config.environment,
    format: resolveLogFormat(config.format),
    level: config.pinoLevel ?? config.legacyLevel,
    otelExportEnabled: config.pinoOtelEnabled === "true",
    consoleLevel: config.consoleLevel ?? config.legacyConsoleLevel,
    otelLevel: config.otelLevel ?? config.legacyOtelLevel,
    serviceName: config.serviceName,
    serviceVersion: resolveServiceVersion(config),
    deploymentEnvironment: config.deploymentEnvironment,
    otelTransportServiceVersion: config.transportServiceVersion,
  };
}

function resolveLogFormat(value: string | undefined): "pretty" | "json" | undefined {
  return value === "pretty" || value === "json" ? value : void 0;
}

function resolveServiceVersion(config: LegacyLoggerConfig): string | undefined {
  const explicit = config.serviceVersion?.trim();
  if (explicit) return explicit;

  const attributes = config.resourceAttributes;
  if (!attributes) return void 0;

  for (const pair of attributes.split(",")) {
    const separator = pair.indexOf("=");
    if (separator === -1 || pair.slice(0, separator).trim() !== "service.version") {
      continue;
    }

    const value = decodeAttributeValue(pair.slice(separator + 1).trim());
    if (value) return value;
  }

  return void 0;
}

function decodeAttributeValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
