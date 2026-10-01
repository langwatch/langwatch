import { DEFAULT_SERVICE_NAME } from "./constants.ts";

export type LoggerFormat = "pretty" | "json";

/**
 * Process configuration for logger construction. Composition parses
 * deployment environment variables into these semantic values before any
 * process creates a logger — the package itself has no environment access.
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
  /**
   * Field names pino masks in every record. The boot seam passes the secret
   * class from `@langwatch/secrets`; this package holds no list of its own.
   */
  redactPaths?: readonly string[];
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
  readonly redactPaths: readonly string[];
}

/** Deterministic package defaults for an unconfigured development process. */
export const DEFAULT_LOGGER_CONFIGURATION: ResolvedLoggerConfiguration = {
  environment: "development",
  format: "json",
  level: "debug",
  otelExportEnabled: false,
  consoleLevel: "info",
  otelLevel: "debug",
  serviceName: DEFAULT_SERVICE_NAME,
  serviceVersion: void 0,
  deploymentEnvironment: "development",
  otelTransportServiceVersion: "1.0.0",
  redactPaths: [],
};

export function resolveLoggerConfiguration(
  configuration: LoggerConfiguration = {},
): ResolvedLoggerConfiguration {
  const environment = configuration.environment ?? DEFAULT_LOGGER_CONFIGURATION.environment;
  const isTest = environment === "test";
  // JSON in every environment (dev/docs/best_practices/dev-log-format.md):
  // haven and `pnpm dev` render it through their own shared renderer, so
  // dev and production emit the same record shape. `LOG_FORMAT=pretty` is
  // the explicit opt-out for a lane run bare with no renderer in front of it.
  const format = configuration.format ?? "json";
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
    redactPaths: configuration.redactPaths ?? DEFAULT_LOGGER_CONFIGURATION.redactPaths,
  };
}

/**
 * The process-config shape API, worker (and any future process) hand this
 * package to produce a `LoggerConfiguration`. Kept structural on purpose:
 * this port takes only the slice of each process's own `Config` a logger reads.
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
 * Maps a process configuration into the `LoggerConfiguration` a logger is
 * built from. One place every process hands its parsed config to, so a new
 * logger field lands in exactly one map instead of drifting across N copies.
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
