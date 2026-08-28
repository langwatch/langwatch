import pino, {
  type DestinationStream,
  type LoggerOptions,
  type Logger as PinoLogger,
} from "pino";
import type SuperJSON from "superjson";
import { DEFAULT_SERVICE_NAME, REQUEST_CAUSE_FIELD } from "./constants";
import {
  resolveLoggerConfiguration,
  type LoggerConfiguration,
  type ResolvedLoggerConfiguration,
} from "./logger-config";

export type {
  LoggerConfiguration,
  LoggerFormat,
  ResolvedLoggerConfiguration,
} from "./logger-config";

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

/**
 * Every key a cause may be logged under, mapped to the same serializer.
 *
 * pino matches serializers by exact property name and nothing warns when a key
 * has none: the value is passed to `JSON.stringify`, and an `Error` has no
 * enumerable own properties, so it lands as `{}` with the message and stack -
 * the only reasons it was logged - gone. Keeping the map in one exported
 * constant is what lets a test drive the real thing rather than a copy of it.
 *
 * `error` for records that ARE failures; {@link REQUEST_CAUSE_FIELD} for the
 * cause on records deliberately logged below error level.
 */
export const NODE_LOG_SERIALIZERS = {
  error: superjsonErrorSerializer,
  [REQUEST_CAUSE_FIELD]: superjsonErrorSerializer,
} as const;

export interface CreateLoggerOptions {
  /**
   * Disable automatic context injection (traceId, spanId, organizationId,
   * projectId, and userId). This option has no effect in the browser.
   */
  disableContext?: boolean;
}

/**
 * Creates a Pino logger with one API for Node.js and browser consumers.
 *
 * Node.js loggers use the shared console/OTel transport and inject registered
 * async request context. Browser loggers use Pino's browser mode and never load
 * the package's OpenTelemetry or Node-only context modules.
 */
// One logger per (name, disableContext) pair, kept for the life of the process.
//
// `createLogger` has 400+ call sites, many of them per-instance class fields
// and a few inline in catch blocks, so a fresh `pino()` per call was measured
// at 2.3% of the app's wall time in production — nearly a quarter of that
// inside `pino/lib/caller.js:getCallers`, which captures a stack trace on
// every construction to work out who called it. None of that work varies
// between calls that pass the same name.
//
// Sharing an instance is safe because nothing request-scoped is baked in at
// construction. `name`, `service` and `service.version` are process-wide, and
// the per-request fields — traceId, spanId, organizationId, projectId, userId
// — arrive through the `mixin` in createNodeLogger, which pino invokes on
// every log call and which reads the async-local context at that moment. Two
// requests sharing a logger still get their own context on their own lines.
// The transport above is shared for the same reason.
//
// The cache is bounded by the number of distinct logger names in the source.
// The handful of call sites that build a name rather than writing a literal
// derive it from module or route identity, never from tenant or request data;
// a name derived per project would make this grow without limit.
//
// `disableContext` is part of the key because it is the one option that
// changes the logger that gets constructed.
export interface LoggerFactory {
  createLogger(name: string, options?: CreateLoggerOptions): PinoLogger;
  reset(): void;
}

let activeLoggerConfiguration = resolveLoggerConfiguration();
let loggerFactory = createLoggerFactory();

/**
 * Installs process logger configuration before composition imports modules that
 * create loggers. Repeating the same semantic configuration is a no-op, so a
 * second boot hook cannot replace cached loggers or create another transport.
 */
export function configureLogger(configuration: LoggerConfiguration): void {
  const resolved = resolveLoggerConfiguration(configuration);
  if (sameLoggerConfiguration(activeLoggerConfiguration, resolved)) return;

  activeLoggerConfiguration = resolved;
  loggerFactory = createLoggerFactory(configuration);
}

/** Creates an isolated logger factory for one configured process or test. */
export function createLoggerFactory(configuration: LoggerConfiguration = {}): LoggerFactory {
  const resolved = resolveLoggerConfiguration(configuration);
  const loggerCache = new Map<string, PinoLogger>();
  let sharedTransport: DestinationStream | null = null;
  let isTransportInitialized = false;

  const getSharedTransport = (): DestinationStream | null => {
    if (!isNodeRuntime || isTransportInitialized) {
      return sharedTransport;
    }
    isTransportInitialized = true;

    if (resolved.environment === "test") {
      return null;
    }

    try {
      sharedTransport = buildTransport(resolved);
    } catch (error) {
      console.error("Failed to create pino transport, falling back to stdout:", error);
      sharedTransport = null;
    }

    return sharedTransport;
  };

  const create = (name: string, options?: CreateLoggerOptions): PinoLogger => {
    const key = options?.disableContext ? `-${name}` : `+${name}`;
    const cached = loggerCache.get(key);
    if (cached) return cached;

    const logger = isNodeRuntime
      ? createNodeLogger(name, options, resolved, getSharedTransport)
      : createBrowserLogger(
          name,
          configuration.level ?? (resolved.environment === "test" ? "error" : "info"),
        );
    loggerCache.set(key, logger);
    return logger;
  };

  return { createLogger: create, reset: () => loggerCache.clear() };
}

/**
 * Drops the memoised loggers.
 *
 * Only tests need this. They replace the injected configuration between cases,
 * and a process-lifetime cache would otherwise pin a logger to the first one.
 */
export function resetLoggerCache(): void {
  loggerFactory.reset();
}

export function createLogger(name: string, options?: CreateLoggerOptions): PinoLogger {
  return loggerFactory.createLogger(name, options);
}

function createBrowserLogger(name: string, level: string): PinoLogger {
  return pino({
    name,
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    // Both keys, same serializer. pino matches serializers by exact property
    // name, so a cause moved to REQUEST_CAUSE_FIELD and not registered here is
    // emitted as a bare Error - which serialises to `{}`, losing the message
    // and stack that are the whole reason it was logged.
    serializers: {
      error: pino.stdSerializers.err,
      [REQUEST_CAUSE_FIELD]: pino.stdSerializers.err,
    },
    formatters: {
      bindings: (bindings) => bindings,
      level: (label) => ({ level: label.toUpperCase() }),
    },
    browser: { asObject: true },
  });
}

/** Adds the configured build identity only when the process supplied one. */
export function serviceVersionField(
  configuration: Pick<ResolvedLoggerConfiguration, "serviceVersion">,
): Record<string, string> {
  return configuration.serviceVersion ? { "service.version": configuration.serviceVersion } : {};
}

function createNodeLogger(
  name: string,
  options: CreateLoggerOptions | undefined,
  configuration: ResolvedLoggerConfiguration,
  getSharedTransport: () => DestinationStream | null,
): PinoLogger {
  const pinoOptions: LoggerOptions = {
    name,
    level: configuration.level,
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: NODE_LOG_SERIALIZERS,
    formatters: {
      // Adds process identity alongside pino's own pid/hostname bindings,
      // distinct from `name` (the per-module label like "langwatch:api:hono").
      // Prod ships stdout through fluent-bit, which promotes this field to the
      // Loki `service_name` label — it is how the Go services land under
      // `langwatch-service-aigateway` / `-nlp` (pkg/clog stamps the same
      // field). Without it every line from this app arrives as
      // `service_name="fluent-bit"`, unfilterable by service. Done here rather
      // than via `base` so pino keeps supplying pid/hostname and this module
      // stays free of a node:os import (it must remain browser-safe).
      bindings: (bindings) => ({
        ...bindings,
        service: configuration.serviceName,
        // Which build produced the line.
        //
        // The configuration root derives this from the same OTel resource
        // identity used for traces, but that resource only reaches telemetry we
        // export.
        // These logs go to stdout and are picked up from the pod's log file, a
        // path the resource never touches, so no log line has ever carried a
        // version: measured 2026-08-07, `service_version` appeared on no record
        // in the fleet. Injecting the same semantic value keeps one source of
        // truth rather than introducing a second way to say it.
        ...serviceVersionField(configuration),
      }),
      level: (label) => ({ level: label.toUpperCase() }),
    },
    mixin: options?.disableContext ? undefined : () => logContextProvider?.() ?? {},
  };

  const transport = getSharedTransport();
  return transport ? pino(pinoOptions, transport) : pino(pinoOptions, process.stdout);
}

function buildTransport(configuration: ResolvedLoggerConfiguration): DestinationStream {
  const targets: pino.TransportTargetOptions[] = [
    buildConsoleTransport({
      usePretty: configuration.format === "pretty",
      level: configuration.consoleLevel,
      isOtelExportEnabled: configuration.otelExportEnabled,
    }),
  ];

  if (configuration.otelExportEnabled) {
    targets.push(buildOtelTransport(configuration));
  }

  return pino.transport({ targets });
}

// `service` is constant for the process and only exists so fluent-bit can
// promote it to a Loki label — it is pure noise on a local console line.
const BASE_CONSOLE_IGNORE = "pid,hostname,service";
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
  usePretty,
  level,
  isOtelExportEnabled,
}: {
  usePretty: boolean;
  level: string;
  isOtelExportEnabled: boolean;
}): pino.TransportTargetOptions {
  if (usePretty) {
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

function buildOtelTransport(
  configuration: ResolvedLoggerConfiguration,
): pino.TransportTargetOptions {
  return {
    target: "pino-opentelemetry-transport",
    options: {
      // Kept fixed for the existing OTel log pipeline. `service.name` below is
      // the configured process identity; changing loggerName would create a
      // second OTel instrumentation scope without an ADR.
      loggerName: DEFAULT_SERVICE_NAME,
      serviceVersion: configuration.otelTransportServiceVersion,
      resourceAttributes: {
        "service.name": configuration.serviceName,
        "deployment.environment.name": configuration.deploymentEnvironment,
      },
    },
    level: configuration.otelLevel,
  };
}

function sameLoggerConfiguration(
  left: ResolvedLoggerConfiguration,
  right: ResolvedLoggerConfiguration,
): boolean {
  const leftValues = loggerConfigurationValues(left);
  const rightValues = loggerConfigurationValues(right);
  return leftValues.every((value, index) => value === rightValues[index]);
}

function loggerConfigurationValues(
  configuration: ResolvedLoggerConfiguration,
): readonly (string | boolean | undefined)[] {
  return [
    configuration.environment,
    configuration.format,
    configuration.level,
    configuration.otelExportEnabled,
    configuration.consoleLevel,
    configuration.otelLevel,
    configuration.serviceName,
    configuration.serviceVersion,
    configuration.deploymentEnvironment,
    configuration.otelTransportServiceVersion,
  ];
}

export type Logger = PinoLogger;
