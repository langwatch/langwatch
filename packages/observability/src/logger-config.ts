import { DEFAULT_SERVICE_NAME } from "./constants";

export type LoggerFormat = "pretty" | "json";

/**
 * Process configuration for logger construction.
 *
 * Composition parses deployment environment variables into these semantic
 * values before any process creates a logger. The package deliberately has no
 * environment access of its own.
 */
export interface LoggerConfiguration {
  /** Runtime mode controls defaults such as test-level logging and pretty output. */
  environment?: string;
  /** Explicit console representation; omitted selects the environment default. */
  format?: LoggerFormat;
  /** Minimum level for logger calls. */
  level?: string;
  /** Enables the Pino-to-OTel transport. */
  otelExportEnabled?: boolean;
  /** Console transport level. */
  consoleLevel?: string;
  /** OTel transport level. */
  otelLevel?: string;
  /** Process service identity attached to log records and OTel resources. */
  serviceName?: string;
  /** Build identity attached to ordinary log records when present. */
  serviceVersion?: string;
  /** Deployment identity attached to the OTel log resource. */
  deploymentEnvironment?: string;
  /** Pino OTel transport build identity. */
  otelTransportServiceVersion?: string;
}

export interface ResolvedLoggerConfiguration {
  readonly environment: string;
  readonly format: LoggerFormat;
  readonly level: string;
  readonly otelExportEnabled: boolean;
  readonly consoleLevel: string;
  readonly otelLevel: string;
  readonly serviceName: string;
  readonly serviceVersion: string | undefined;
  readonly deploymentEnvironment: string;
  readonly otelTransportServiceVersion: string;
}

/** Deterministic package defaults for an unconfigured development process. */
export const DEFAULT_LOGGER_CONFIGURATION: ResolvedLoggerConfiguration = {
  environment: "development",
  format: "pretty",
  level: "debug",
  otelExportEnabled: false,
  consoleLevel: "info",
  otelLevel: "debug",
  serviceName: DEFAULT_SERVICE_NAME,
  serviceVersion: void 0,
  deploymentEnvironment: "development",
  otelTransportServiceVersion: "1.0.0",
};

export function resolveLoggerConfiguration(
  configuration: LoggerConfiguration = {},
): ResolvedLoggerConfiguration {
  const environment = configuration.environment ?? DEFAULT_LOGGER_CONFIGURATION.environment;
  const isTest = environment === "test";
  const format = configuration.format ?? (environment === "production" ? "json" : "pretty");
  const defaultLevel = isTest ? "error" : DEFAULT_LOGGER_CONFIGURATION.level;

  return {
    environment,
    format,
    level: configuration.level ?? defaultLevel,
    otelExportEnabled:
      configuration.otelExportEnabled ?? DEFAULT_LOGGER_CONFIGURATION.otelExportEnabled,
    consoleLevel: configuration.consoleLevel ?? DEFAULT_LOGGER_CONFIGURATION.consoleLevel,
    otelLevel: configuration.otelLevel ?? DEFAULT_LOGGER_CONFIGURATION.otelLevel,
    serviceName: configuration.serviceName ?? DEFAULT_LOGGER_CONFIGURATION.serviceName,
    serviceVersion: configuration.serviceVersion?.trim() || void 0,
    deploymentEnvironment:
      configuration.deploymentEnvironment ?? DEFAULT_LOGGER_CONFIGURATION.deploymentEnvironment,
    otelTransportServiceVersion:
      configuration.otelTransportServiceVersion ??
      DEFAULT_LOGGER_CONFIGURATION.otelTransportServiceVersion,
  };
}

/**
 * The process-config shape both API and worker (and any future process) hand
 * this package to produce their `LoggerConfiguration`. Kept structural on
 * purpose: every process defines its own `Config` type, and this port takes
 * the slice of it a logger reads — never the whole thing.
 */
export interface ProcessLoggerInputs {
  nodeEnvironment?: string;
  environment?: string;
  serviceName?: string;
  serviceVersion?: string;
  logger: {
    format?: LoggerFormat;
    level?: string;
    consoleLevel?: string;
    otelExportEnabled?: boolean;
  };
}

/**
 * Map a process configuration into the `LoggerConfiguration` the package
 * builds a logger from. One place: every process (api, worker, and any future
 * one) hands its parsed config here, so a new logger field lands in exactly
 * one map instead of drifting across N copies.
 */
export function loggerConfigurationFrom(inputs: ProcessLoggerInputs): LoggerConfiguration {
  return {
    environment: inputs.nodeEnvironment,
    format: inputs.logger.format,
    level: inputs.logger.level,
    consoleLevel: inputs.logger.consoleLevel,
    otelExportEnabled: inputs.logger.otelExportEnabled,
    serviceName: inputs.serviceName,
    serviceVersion: inputs.serviceVersion,
    deploymentEnvironment: inputs.environment,
  };
}
