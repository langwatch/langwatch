import pino, { type LoggerOptions, type Logger as PinoLogger } from "pino";
import { getContext } from "../server/context/contextProvider";

// Initialize context provider registration (no-op if already done)
// This ensures getLogContext is registered before any logger is created
import "../server/context/init";

const isBrowser = typeof window !== "undefined";

export interface CreateLoggerOptions {
  /**
   * Disable automatic context injection (traceId, spanId, organizationId, projectId, userId).
   * By default, context is automatically included in all log entries when available.
   * Set to true to disable this behavior.
   */
  disableContext?: boolean;
}

/**
 * Creates a logger instance with the given name.
 *
 * Server-side: Uses pino transports for console output and optional OTel export.
 * Browser: Uses pino's browser mode with console output.
 *
 * Environment variables:
 * - PINO_CONSOLE_LEVEL: Console log level (default: "warn" in dev, "info" in prod)
 * - PINO_OTEL_LEVEL: OTel export level (default: "debug")
 * - OTEL_EXPORTER_OTLP_ENDPOINT: Enable OTel log export to this endpoint
 *
 * @param name - Logger name (e.g., "langwatch:api:hono")
 * @param options - Optional configuration
 */
export const createLogger = (
  name: string,
  options?: CreateLoggerOptions,
): PinoLogger => {
  if (isBrowser) {
    return pino({ name, level: "info", browser: { asObject: true } });
  }

  return createServerLogger(name, options);
};

function createServerLogger(
  name: string,
  options?: CreateLoggerOptions,
): PinoLogger {
  const isDevMode = process.env.NODE_ENV !== "production";
  const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  const consoleLevel =
    process.env.PINO_CONSOLE_LEVEL ?? (isDevMode ? "warn" : "info");
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

  const transport = buildTransport({ isDevMode, otelEndpoint, consoleLevel, otelLevel });

  return pino(pinoOptions, transport);
}

function buildTransport(config: {
  isDevMode: boolean;
  otelEndpoint: string | undefined;
  consoleLevel: string;
  otelLevel: string;
}) {
  const { isDevMode, otelEndpoint, consoleLevel, otelLevel } = config;

  const targets: pino.TransportTargetOptions[] = [
    buildConsoleTransport(isDevMode, consoleLevel),
  ];

  if (otelEndpoint) {
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
      target: require.resolve("pino-pretty"),
      options: { colorize: true, minimumLevel: level },
      level,
    };
  }

  return {
    target: require.resolve("pino/file"),
    options: { destination: 1 },
    level,
  };
}

function buildOtelTransport(level: string): pino.TransportTargetOptions {
  return {
    target: require.resolve("pino-opentelemetry-transport"),
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
