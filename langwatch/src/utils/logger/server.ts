import pino, { type LoggerOptions, type Logger as PinoLogger } from "pino";
import { getLogContext } from "../../server/context/logging";

export interface CreateLoggerOptions {
  /**
   * Disable automatic context injection (traceId, spanId, organizationId, projectId, userId).
   */
  disableContext?: boolean;
}

/**
 * Creates a server-side logger with context injection and transports.
 *
 * Environment variables:
 * - PINO_CONSOLE_LEVEL: Console log level (default: "info")
 * - PINO_OTEL_ENABLED: Set to "true" to enable OTel log export
 * - PINO_OTEL_LEVEL: OTel export level (default: "debug")
 */
export const createLogger = (
  name: string,
  options?: CreateLoggerOptions,
): PinoLogger => {
  const isDevMode = process.env.NODE_ENV !== "production";
  const otelLogsEnabled = process.env.PINO_OTEL_ENABLED === "true";

  const isTest = process.env.NODE_ENV === "test";
  const defaultLevel = isTest ? "error" : "debug";
  const consoleLevel = process.env.PINO_CONSOLE_LEVEL ?? (isTest ? "error" : "info");
  const otelLevel = process.env.PINO_OTEL_LEVEL ?? "debug";
  const baseLevel = process.env.PINO_LOG_LEVEL ?? process.env._LOG_LEVEL ?? defaultLevel;

  const pinoOptions: LoggerOptions = {
    name,
    level: baseLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { error: pino.stdSerializers.err },
    formatters: {
      bindings: (bindings) => bindings,
      level: (label) => ({ level: label.toUpperCase() }),
    },
    mixin: options?.disableContext ? undefined : () => getLogContext(),
  };

  // In test mode, skip transports to avoid spawning worker threads
  // (which add exit listeners and cause MaxListenersExceededWarning)
  if (isTest) {
    return pino(pinoOptions, process.stdout);
  }

  try {
    const transport = buildTransport({
      isDevMode,
      otelLogsEnabled,
      consoleLevel,
      otelLevel,
    });
    return pino(pinoOptions, transport);
  } catch (error) {
    console.error(
      "Failed to create pino transport, falling back to stdout:",
      error,
    );
    return pino(pinoOptions, process.stdout);
  }
};

function buildTransport(config: {
  isDevMode: boolean;
  otelLogsEnabled: boolean;
  consoleLevel: string;
  otelLevel: string;
}) {
  const { isDevMode, otelLogsEnabled, consoleLevel, otelLevel } = config;

  const targets: pino.TransportTargetOptions[] = [
    buildConsoleTransport(isDevMode, consoleLevel),
  ];

  if (otelLogsEnabled) {
    targets.push(buildOtelTransport(otelLevel));
  }

  return pino.transport({ targets });
}

function buildConsoleTransport(
  isDevMode: boolean,
  level: string,
): pino.TransportTargetOptions {
  if (isDevMode) {
    return {
      target: "pino-pretty",
      options: { colorize: true, minimumLevel: level },
      level,
    };
  }

  return {
    target: "pino/file",
    options: { destination: 1 },
    level,
  };
}

function buildOtelTransport(level: string): pino.TransportTargetOptions {
  return {
    target: "pino-opentelemetry-transport",
    options: {
      loggerName: "langwatch-backend",
      serviceVersion: process.env.npm_package_version ?? "1.0.0",
      resourceAttributes: {
        "service.name": process.env.OTEL_SERVICE_NAME ?? "langwatch-backend",
        "deployment.environment": process.env.ENVIRONMENT ?? "development",
      },
    },
    level,
  };
}

export type Logger = PinoLogger;
