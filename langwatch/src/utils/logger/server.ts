import superjson from "superjson";
import pino, { type LoggerOptions, type Logger as PinoLogger, type DestinationStream } from "pino";
import { getLogContext } from "../../server/context/logging";

/**
 * Custom Error serializer using superjson.
 * Avoids expensive manual stack trace formatting while preserving all metadata.
 */
const superjsonErrorSerializer = (err: any) => {
  if (!(err instanceof Error)) {
    return pino.stdSerializers.err(err);
  }

  // Use superjson to serialize the error object efficiently
  const serialized = superjson.serialize(err);
  
  return {
    ...pino.stdSerializers.err(err),
    // Include the superjson metadata for better downstream reconstruction if needed
    // but keep standard fields for compatibility with typical log viewers
    _superjson: serialized.meta,
  };
};

export interface CreateLoggerOptions {
  /**
   * Disable automatic context injection (traceId, spanId, organizationId, projectId, userId).
   */
  disableContext?: boolean;
}

// Singleton transport instance to avoid spawning multiple worker threads.
// Each pino.transport() call adds exit listeners; sharing one prevents
// MaxListenersExceededWarning.
let sharedTransport: DestinationStream | null = null;
let transportInitialized = false;

function getSharedTransport(): DestinationStream | null {
  if (transportInitialized) {
    return sharedTransport;
  }
  transportInitialized = true;

  const isDevMode = process.env.NODE_ENV !== "production";
  const isTest = process.env.NODE_ENV === "test";

  // In test mode, skip transports to avoid spawning worker threads
  if (isTest) {
    return null;
  }

  // The pino → OTel log transport (pino-opentelemetry-transport) runs in the
  // same worker thread as the pretty console and, in this Node/pino build,
  // silences that whole worker — so with it on, the local console shows nothing.
  // Restrict it to production, where the console is raw JSON on its own stream
  // and there's a real collector. Traces are unaffected (they go via the OTel
  // SDK, not pino). Locally you read the pretty console; prod still ships logs.
  const otelLogsEnabled =
    process.env.PINO_OTEL_ENABLED === "true" &&
    process.env.NODE_ENV === "production";
  // Unified log-level env vars, shared with the Go services (pkg/clog) so one
  // set in langwatch/.env configures both. PINO_* kept as fallback for compat.
  const consoleLevel =
    process.env.LOG_CONSOLE_LEVEL ?? process.env.PINO_CONSOLE_LEVEL ?? "info";
  const otelLevel =
    process.env.LOG_OTEL_LEVEL ?? process.env.PINO_OTEL_LEVEL ?? "debug";
  // When the observability stack is up (haven sets PINO_OTEL_ENABLED), the full
  // record is in Grafana, so the pretty console drops the heavy business-context
  // fields and keeps only trace/span for correlation — see consoleIgnoreFields.
  const otelExportOn = process.env.PINO_OTEL_ENABLED === "true";

  try {
    sharedTransport = buildTransport({
      isDevMode,
      otelLogsEnabled,
      otelExportOn,
      consoleLevel,
      otelLevel,
    });
  } catch (error) {
    console.error(
      "Failed to create pino transport, falling back to stdout:",
      error,
    );
    sharedTransport = null;
  }

  return sharedTransport;
}

/**
 * Creates a server-side logger with context injection and transports.
 *
 * Environment variables (unified with the Go services — see pkg/clog):
 * - LOG_CONSOLE_LEVEL (fallback PINO_CONSOLE_LEVEL): console level (default "info")
 * - LOG_OTEL_LEVEL (fallback PINO_OTEL_LEVEL): collector export level (default "debug")
 * - PINO_OTEL_ENABLED: "true" to export logs to the OTel collector
 * Split-stream: set LOG_CONSOLE_LEVEL=warn + LOG_OTEL_LEVEL=debug so the console
 * shows only warnings/errors while info/debug flow to the observability stack.
 */
export const createLogger = (
  name: string,
  options?: CreateLoggerOptions,
): PinoLogger => {
  const isTest = process.env.NODE_ENV === "test";
  const defaultLevel = isTest ? "error" : "debug";
  const baseLevel = process.env.PINO_LOG_LEVEL ?? process.env._LOG_LEVEL ?? defaultLevel;

  const pinoOptions: LoggerOptions = {
    name,
    level: baseLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { error: superjsonErrorSerializer },
    formatters: {
      bindings: (bindings) => bindings,
      level: (label) => ({ level: label.toUpperCase() }),
    },
    mixin: options?.disableContext ? undefined : () => getLogContext(),
  };

  const transport = getSharedTransport();
  if (transport) {
    return pino(pinoOptions, transport);
  }

  return pino(pinoOptions, process.stdout);
};

function buildTransport(config: {
  isDevMode: boolean;
  otelLogsEnabled: boolean;
  otelExportOn: boolean;
  consoleLevel: string;
  otelLevel: string;
}) {
  const { isDevMode, otelLogsEnabled, otelExportOn, consoleLevel, otelLevel } =
    config;

  const targets: pino.TransportTargetOptions[] = [
    buildConsoleTransport(isDevMode, consoleLevel, otelExportOn),
  ];

  if (otelLogsEnabled) {
    targets.push(buildOtelTransport(otelLevel));
  }

  return pino.transport({ targets });
}

/**
 * The context fields the pino mixin (getLogContext) stamps on every record. When
 * the observability stack is up they are all in Grafana, so the pretty console
 * drops the business-context ones — keeping only trace_id/span_id for
 * correlation — to stop every line ballooning. With the stack down the console is
 * the only place they exist, so they stay.
 */
const BASE_CONSOLE_IGNORE = "pid,hostname";
const HEAVY_CONTEXT_FIELDS = ["organizationId", "projectId", "userId"];

export function consoleIgnoreFields(otelExportOn: boolean): string {
  return otelExportOn
    ? [BASE_CONSOLE_IGNORE, ...HEAVY_CONTEXT_FIELDS].join(",")
    : BASE_CONSOLE_IGNORE;
}

function buildConsoleTransport(
  isDevMode: boolean,
  level: string,
  otelExportOn: boolean,
): pino.TransportTargetOptions {
  if (isDevMode) {
    return {
      target: "pino-pretty",
      // Tuned to sit close to the Go services' pkg/clog output: a kitchen clock
      // (`2:00PM`) and one line per record, without the pid/hostname noise.
      // Kept to plain string options so the whole thing serializes into the
      // pino-pretty worker thread — no functions, no custom stream.
      options: {
        colorize: true,
        translateTime: "SYS:h:MMTT",
        ignore: consoleIgnoreFields(otelExportOn),
        singleLine: true,
        minimumLevel: level,
      },
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
