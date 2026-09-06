import pino, { type DestinationStream, type LoggerOptions, type Logger as PinoLogger } from "pino";
import { DEFAULT_SERVICE_NAME, REQUEST_CAUSE_FIELD } from "./constants.ts";
import {
  resolveLoggerConfiguration,
  type LoggerConfiguration,
  type ResolvedLoggerConfiguration,
} from "./logger-config.ts";

export type {
  LoggerConfiguration,
  LoggerFormat,
  ProcessLoggerInputs,
  ResolvedLoggerConfiguration,
} from "./logger-config.ts";
export { loggerConfigurationFrom } from "./logger-config.ts";

type LogContextProvider = () => Record<string, string | null>;

const isNodeRuntime = typeof process !== "undefined" && typeof process.versions?.node === "string";

let logContextProvider: LogContextProvider | undefined;

/**
 * Registers the server context provider used by every logger mixin. Injected
 * rather than imported so this module stays safe to load in a browser.
 */
export function registerLogContextProvider(provider: LogContextProvider): void {
  logContextProvider = provider;
}

/**
 * The request and tenant context, with the fields that have no value left off:
 * a present field lets a `traceId != ""` filter work downstream, where a
 * stamped `null` string would match it by accident.
 */
function presentLogContext(): Record<string, string> {
  const context = logContextProvider?.();
  if (!context) return {};

  const present: Record<string, string> = {};
  for (const [field, value] of Object.entries(context)) {
    if (value !== null) present[field] = value;
  }
  return present;
}

/**
 * The JSON-safe form of one logged value: renders a `bigint` (which
 * `JSON.stringify` throws on) and a nested `Error` (whose message/stack are
 * non-enumerable, so it would otherwise serialise to `{}`).
 */
function jsonSafe(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return pino.stdSerializers.err(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => jsonSafe(entry, seen));
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) out[key] = jsonSafe(entry, seen);
  return out;
}

/**
 * Custom Error serializer: keeps pino's message/stack/cause handling and also
 * walks the error's own enumerable properties, so a `bigint` or nested
 * `Error` on a custom error class survives instead of being dropped.
 */
const errorSerializer = (error: unknown) => {
  if (!(error instanceof Error)) {
    return pino.stdSerializers.err(error as Error);
  }

  const base = pino.stdSerializers.err(error);
  const own = jsonSafe({ ...error }, new WeakSet()) as Record<string, unknown>;
  return { ...base, ...own };
};

/**
 * Every key a cause may be logged under, mapped to the same serializer: pino
 * matches serializers by exact property name, and an unregistered key
 * serialises an `Error` to `{}` (no message, no stack).
 */
export const NODE_LOG_SERIALIZERS = {
  error: errorSerializer,
  [REQUEST_CAUSE_FIELD]: errorSerializer,
} as const;

export interface CreateLoggerOptions {
  /**
   * Disable automatic context injection (traceId, spanId, organizationId,
   * projectId, and userId). This option has no effect in the browser.
   */
  disableContext?: boolean;
}

/**
 * Creates a Pino logger, cached per (name, disableContext) pair: a fresh
 * `pino()` per call measured at 2.3% of production wall time. Safe to share
 * since per-request fields arrive fresh on every call via the mixin.
 */
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

/** Drops the memoised loggers; only tests need this, between cases. */
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
      level: (label) => ({ level: label }),
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
      // Adds process identity (distinct from `name`, the per-module label):
      // fluent-bit promotes this to the Loki `service_name` label, so prod
      // logs stay filterable by service. Set here rather than via `base` so
      // this module stays free of a node:os import (must remain browser-safe).
      bindings: (bindings) => ({
        ...bindings,
        service: configuration.serviceName,
        // Which build produced the line: stdout logs bypass the OTel resource
        // (measured 2026-08-07, `service_version` appeared on no fleet
        // record), so this injects the same semantic value directly instead.
        ...serviceVersionField(configuration),
      }),
      // Lowercase, matching the Go services and Loki's own `detected_level`
      // (dev/docs/best_practices/dev-log-format.md). This is the wire value:
      // a LogQL filter written against the old `WARN`/`ERROR` needs widening.
      level: (label) => ({ level: label }),
    },
    mixin: options?.disableContext ? undefined : () => presentLogContext(),
  };
  // The last line of defence, not the first: a classified secret is meant to
  // stop at the composition root, and this masks the field by name for the
  // one that reaches a record anyway.
  if (configuration.redactPaths.length > 0) {
    pinoOptions.redact = { paths: [...configuration.redactPaths], censor: "[redacted]" };
  }

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

/**
 * Pretty-console options for a `pnpm dev` line: no date or process identity
 * (concurrently prefixes the lane). Must survive `structuredClone` — no
 * formatter functions, since options cross a worker-thread boundary.
 */
export function prettyConsoleOptions({
  level,
  isOtelExportEnabled,
}: {
  level: string;
  isOtelExportEnabled: boolean;
}): Record<string, unknown> {
  return {
    colorize: true,
    singleLine: true,
    ignore: consoleIgnoreFields(isOtelExportEnabled),
    minimumLevel: level,
    translateTime: "SYS:HH:MM:ss.l",
  };
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
      options: prettyConsoleOptions({ level, isOtelExportEnabled }),
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
    configuration.redactPaths.join(","),
  ];
}

export type Logger = PinoLogger;
