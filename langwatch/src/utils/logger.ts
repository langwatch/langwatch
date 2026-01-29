import pino, { type LoggerOptions, type Logger as PinoLogger } from "pino";
import { getContext } from "../server/context/contextProvider";

const isBrowser = typeof window !== "undefined";
const isNodeDev = !isBrowser && process.env.NODE_ENV !== "production";
const otelEndpoint = !isBrowser
  ? process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  : undefined;

// Console level: WARN+ in dev by default, configurable
const consoleLevel = !isBrowser
  ? (process.env.PINO_CONSOLE_LEVEL ?? (isNodeDev ? "warn" : "info"))
  : "info";

// OTel level: DEBUG+ by default (or configurable)
const otelLevel = !isBrowser
  ? (process.env.PINO_OTEL_LEVEL ?? "debug")
  : "debug";

// Base level for the logger (lowest of console and otel levels to ensure all messages flow through)
const baseLevel = !isBrowser
  ? (process.env.PINO_LOG_LEVEL ?? process.env._LOG_LEVEL ?? "debug")
  : "info";

export interface CreateLoggerOptions {
  /**
   * Disable automatic context injection (traceId, spanId, organizationId, projectId, userId).
   * By default, context is automatically included in all log entries when available.
   * Set to true to disable this behavior.
   */
  disableContext?: boolean;
}

/**
 * Creates transport configuration for pino.
 * - Console: WARN+ in dev (via pino-pretty), INFO+ in prod (stdout)
 * - OTel: DEBUG+ to OTLP endpoint (when OTEL_EXPORTER_OTLP_ENDPOINT is set)
 */
const getTransport = (): ReturnType<typeof pino.transport> | undefined => {
  if (isBrowser) return undefined;

  const targets: pino.TransportTargetOptions[] = [
    // Console transport
    {
      target: isNodeDev ? "pino-pretty" : "pino/file",
      options: isNodeDev
        ? { colorize: true, minimumLevel: consoleLevel }
        : { destination: 1 },
      level: consoleLevel,
    },
  ];

  // Add OTel transport if endpoint is configured
  if (otelEndpoint) {
    targets.push({
      target: "pino-opentelemetry-transport",
      options: {
        loggerName: "langwatch-backend",
        serviceVersion: process.env.npm_package_version ?? "1.0.0",
        resourceAttributes: {
          "service.name": process.env.OTEL_SERVICE_NAME ?? "langwatch-backend",
          "deployment.environment":
            process.env.ENVIRONMENT ?? "development",
        },
      },
      level: otelLevel,
    });
  }

  return pino.transport({ targets });
};

/**
 * Creates a logger instance with the given name.
 *
 * By default, the logger automatically includes request context (traceId, spanId,
 * organizationId, projectId, userId) in all log entries when available via
 * AsyncLocalStorage. This enables automatic trace correlation.
 *
 * Transport configuration:
 * - Console: WARN+ in dev (PINO_CONSOLE_LEVEL), INFO+ in prod
 * - OTel: DEBUG+ to OTLP endpoint (when OTEL_EXPORTER_OTLP_ENDPOINT is set)
 *
 * @param name - Logger name (e.g., "langwatch:api:hono")
 * @param options - Optional configuration
 * @param options.disableContext - Set to true to disable automatic context injection
 */
export const createLogger = (
  name: string,
  options?: CreateLoggerOptions,
): PinoLogger => {
  // Determine if we should use the mixin for context injection
  const shouldInjectContext = !options?.disableContext && !isBrowser;

  const pinoOptions: LoggerOptions = {
    name,
    // Set to lowest level - individual transports will filter
    level: baseLevel,
    timestamp: isBrowser ? undefined : pino.stdTimeFunctions.isoTime,
    browser: isBrowser ? { asObject: true } : undefined,
    serializers: {
      error: pino.stdSerializers.err,
    },
    formatters: {
      bindings: (bindings) => {
        return bindings;
      },
      level: (label) => {
        return { level: label.toUpperCase() };
      },
    },
    // Use pino's built-in mixin to inject context into every log entry
    mixin: shouldInjectContext ? () => getContext() : undefined,
  };

  const transport = getTransport();

  // Handle both ESM and CJS module formats
  const pinoFactory =
    typeof pino === "function"
      ? pino
      : (pino as unknown as { default: typeof pino }).default;

  return pinoFactory(pinoOptions, transport);
};

export type Logger = PinoLogger;
