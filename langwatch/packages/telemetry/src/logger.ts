import superjson from "superjson";
import pino, {
  type LoggerOptions,
  type Logger as PinoLogger,
  type DestinationStream,
} from "pino";
import { getLogContext } from "./context/logging";

const isNode =
  typeof process !== "undefined" &&
  typeof process.versions?.node === "string";

/**
 * Custom Error serializer using superjson.
 * Avoids expensive manual stack trace formatting while preserving all metadata.
 */
const superjsonErrorSerializer = (err: unknown) => {
  if (!(err instanceof Error)) {
    return pino.stdSerializers.err(err as Error);
  }

  const { json, meta } = superjson.serialize(err);

  return {
    ...pino.stdSerializers.err(err),
    _superjsonData: json,
    _superjsonMeta: meta,
  };
};

export interface CreateLoggerOptions {
  /**
   * Disable automatic context injection (traceId, spanId, organizationId, projectId, userId).
   * Only relevant on the server — ignored in browser environments.
   */
  disableContext?: boolean;
}

// Singleton transport instance to avoid spawning multiple worker threads.
// Each pino.transport() call adds exit listeners; sharing one prevents
// MaxListenersExceededWarning.
let sharedTransport: DestinationStream | null = null;
let transportInitialized = false;

function getSharedTransport(): DestinationStream | null {
  if (!isNode) return null;
  if (transportInitialized) return sharedTransport;
  transportInitialized = true;

  const isDevMode = process.env.NODE_ENV !== "production";
  const isTest = process.env.NODE_ENV === "test";

  if (isTest) return null;

  const otelLogsEnabled = process.env.PINO_OTEL_ENABLED === "true";
  const consoleLevel = process.env.PINO_CONSOLE_LEVEL ?? "info";
  const otelLevel = process.env.PINO_OTEL_LEVEL ?? "debug";

  try {
    sharedTransport = buildTransport({
      isDevMode,
      otelLogsEnabled,
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
 * Creates a logger that works in both server and browser environments.
 *
 * - **Server**: pino transports (pretty / otel), context injection via
 *   AsyncLocalStorage, superjson error serialization.
 * - **Browser**: pino browser mode with `console.*` output.
 *
 * Environment variables (server only):
 * - PINO_CONSOLE_LEVEL: Console log level (default: "info")
 * - PINO_OTEL_ENABLED: Set to "true" to enable OTel log export
 * - PINO_OTEL_LEVEL: OTel export level (default: "debug")
 */
export function createLogger(
  name: string,
  options?: CreateLoggerOptions,
): PinoLogger {
  if (!isNode) {
    return createBrowserLogger(name);
  }
  return createServerLogger(name, options);
}

// ── Browser ──────────────────────────────────────────────────────────

function createBrowserLogger(name: string): PinoLogger {
  const isTest = process.env.NODE_ENV === "test";
  const level = isTest ? "error" : (process.env.PINO_LOG_LEVEL ?? "info");

  return pino({
    name,
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { error: pino.stdSerializers.err },
    formatters: {
      bindings: (bindings) => bindings,
      level: (label) => ({ level: label.toUpperCase() }),
    },
    browser: { asObject: true },
  });
}

// ── Server ───────────────────────────────────────────────────────────

function createServerLogger(
  name: string,
  options?: CreateLoggerOptions,
): PinoLogger {
  const isTest = process.env.NODE_ENV === "test";
  const defaultLevel = isTest ? "error" : "debug";
  const baseLevel =
    process.env.PINO_LOG_LEVEL ?? process.env._LOG_LEVEL ?? defaultLevel;

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
}

// ── Transport builders ───────────────────────────────────────────────

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
