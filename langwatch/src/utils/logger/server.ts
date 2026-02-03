import pino, { type LoggerOptions, type Logger as PinoLogger } from "pino";
import { getContext } from "../../server/context/contextProvider";

// Initialize context provider registration (no-op if already done)
// This ensures getLogContext is registered before any logger is created
import "../../server/context/init";

export interface CreateLoggerOptions {
  /**
   * Disable automatic context injection (traceId, spanId, organizationId, projectId, userId).
   * By default, context is automatically included in all log entries when available.
   * Set to true to disable this behavior.
   */
  disableContext?: boolean;
}

/**
 * Creates a server-side logger instance with the given name.
 *
 * Uses pino transports for console output and optional OTel export.
 *
 * Environment variables:
 * - PINO_CONSOLE_LEVEL: Console log level (default: "info")
 * - PINO_OTEL_ENABLED: Set to "true" to enable OTel log export (local dev only)
 * - PINO_OTEL_LEVEL: OTel export level (default: "debug")
 *
 * @param name - Logger name (e.g., "langwatch:api:hono")
 * @param options - Optional configuration
 */
export const createLogger = (
  name: string,
  options?: CreateLoggerOptions,
): PinoLogger => {
  const isDevMode = process.env.NODE_ENV !== "production";
  const otelLogsEnabled = process.env.PINO_OTEL_ENABLED === "true";

  const consoleLevel = process.env.PINO_CONSOLE_LEVEL ?? "info";
  const otelLevel = process.env.PINO_OTEL_LEVEL ?? "debug";
  const baseLevel =
    process.env.PINO_LOG_LEVEL ?? process.env._LOG_LEVEL ?? "debug";

  const pinoOptions: LoggerOptions = {
    name,
    level: baseLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { error: pino.stdSerializers.err },
    formatters: {
      bindings: (bindings) => bindings,
      level: (label) => ({ level: label.toUpperCase() }),
    },
    mixin: options?.disableContext ? undefined : () => getContext(),
  };

  // Try to create transport, fallback to stdout on error
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
