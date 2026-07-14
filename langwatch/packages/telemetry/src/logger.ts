import pino, {
  type DestinationStream,
  type LoggerOptions,
  type Logger as PinoLogger,
} from "pino";
import type SuperJSON from "superjson";
import { DEFAULT_SERVICE_NAME } from "./constants";

type LogContextProvider = () => Record<string, string | null>;

const isNodeRuntime =
  typeof process !== "undefined" && typeof process.versions?.node === "string";

let logContextProvider: LogContextProvider | undefined;
let sharedSuperjson: typeof SuperJSON | undefined;

function getSuperjson(): typeof SuperJSON {
  if (!sharedSuperjson) {
    const { createRequire } = process.getBuiltinModule("node:module");
    const loadModule = createRequire(import.meta.url);
    sharedSuperjson = loadModule("superjson") as typeof SuperJSON;
  }

  return sharedSuperjson;
}

/**
 * Registers the server context provider used by every logger mixin.
 *
 * The provider is injected rather than imported so this module stays safe to
 * load in a browser: no OpenTelemetry or Node-only context module is part of
 * the root package's module graph.
 */
export function registerLogContextProvider(provider: LogContextProvider): void {
  logContextProvider = provider;
}

/**
 * Custom Error serializer using superjson.
 * Avoids expensive manual stack trace formatting while preserving metadata.
 */
const superjsonErrorSerializer = (error: unknown) => {
  if (!(error instanceof Error)) {
    return pino.stdSerializers.err(error as Error);
  }

  const serialized = getSuperjson().serialize(error);

  return {
    ...pino.stdSerializers.err(error),
    _superjson: serialized.meta,
  };
};

export interface CreateLoggerOptions {
  /**
   * Disable automatic context injection (traceId, spanId, organizationId,
   * projectId, and userId). This option has no effect in the browser.
   */
  disableContext?: boolean;
}

// Each pino.transport() call adds exit listeners and starts a worker thread.
// Reusing one transport prevents listener pollution and keeps in-process
// workers on the same output pipeline.
let sharedTransport: DestinationStream | null = null;
let isTransportInitialized = false;

function getSharedTransport(): DestinationStream | null {
  if (!isNodeRuntime || isTransportInitialized) {
    return sharedTransport;
  }
  isTransportInitialized = true;

  const isDevelopment = process.env.NODE_ENV !== "production";
  const isTest = process.env.NODE_ENV === "test";

  if (isTest) {
    return null;
  }

  const isOtelExportEnabled = process.env.PINO_OTEL_ENABLED === "true";
  const consoleLevel =
    process.env.LOG_CONSOLE_LEVEL ?? process.env.PINO_CONSOLE_LEVEL ?? "info";
  const otelLevel =
    process.env.LOG_OTEL_LEVEL ?? process.env.PINO_OTEL_LEVEL ?? "debug";

  try {
    sharedTransport = buildTransport({
      isDevelopment,
      isOtelExportEnabled,
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
 * Creates a Pino logger with one API for Node.js and browser consumers.
 *
 * Node.js loggers use the shared console/OTel transport and inject registered
 * async request context. Browser loggers use Pino's browser mode and never load
 * the package's OpenTelemetry or Node-only context modules.
 */
export function createLogger(
  name: string,
  options?: CreateLoggerOptions,
): PinoLogger {
  return isNodeRuntime
    ? createNodeLogger(name, options)
    : createBrowserLogger(name);
}

function createBrowserLogger(name: string): PinoLogger {
  const isTest =
    typeof process !== "undefined" && process.env.NODE_ENV === "test";
  const level = isTest
    ? "error"
    : typeof process !== "undefined"
      ? (process.env.PINO_LOG_LEVEL ?? "info")
      : "info";

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

function createNodeLogger(
  name: string,
  options?: CreateLoggerOptions,
): PinoLogger {
  const isTest = process.env.NODE_ENV === "test";
  const defaultLevel = isTest ? "error" : "debug";
  const level =
    process.env.PINO_LOG_LEVEL ?? process.env._LOG_LEVEL ?? defaultLevel;

  const pinoOptions: LoggerOptions = {
    name,
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { error: superjsonErrorSerializer },
    formatters: {
      bindings: (bindings) => bindings,
      level: (label) => ({ level: label.toUpperCase() }),
    },
    mixin: options?.disableContext
      ? undefined
      : () => logContextProvider?.() ?? {},
  };

  const transport = getSharedTransport();
  return transport
    ? pino(pinoOptions, transport)
    : pino(pinoOptions, process.stdout);
}

function buildTransport({
  isDevelopment,
  isOtelExportEnabled,
  consoleLevel,
  otelLevel,
}: {
  isDevelopment: boolean;
  isOtelExportEnabled: boolean;
  consoleLevel: string;
  otelLevel: string;
}): DestinationStream {
  const targets: pino.TransportTargetOptions[] = [
    buildConsoleTransport({
      isDevelopment,
      level: consoleLevel,
      isOtelExportEnabled,
    }),
  ];

  if (isOtelExportEnabled) {
    targets.push(buildOtelTransport(otelLevel));
  }

  return pino.transport({ targets });
}

const BASE_CONSOLE_IGNORE = "pid,hostname";
const HEAVY_CONTEXT_FIELDS = ["organizationId", "projectId", "userId"];

/**
 * Selects fields hidden from the pretty console. When OTel export is enabled,
 * business context remains available in Grafana while trace/span IDs stay on
 * the compact console line for correlation.
 */
export function consoleIgnoreFields(isOtelExportEnabled: boolean): string {
  return isOtelExportEnabled
    ? [BASE_CONSOLE_IGNORE, ...HEAVY_CONTEXT_FIELDS].join(",")
    : BASE_CONSOLE_IGNORE;
}

function buildConsoleTransport({
  isDevelopment,
  level,
  isOtelExportEnabled,
}: {
  isDevelopment: boolean;
  level: string;
  isOtelExportEnabled: boolean;
}): pino.TransportTargetOptions {
  if (isDevelopment) {
    return {
      target: "pino-pretty",
      options: {
        colorize: true,
        singleLine: true,
        ignore: consoleIgnoreFields(isOtelExportEnabled),
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
      loggerName: DEFAULT_SERVICE_NAME,
      serviceVersion: process.env.npm_package_version ?? "1.0.0",
      resourceAttributes: {
        "service.name": process.env.OTEL_SERVICE_NAME ?? DEFAULT_SERVICE_NAME,
        "deployment.environment": process.env.ENVIRONMENT ?? "development",
      },
    },
    level,
  };
}

export type Logger = PinoLogger;
