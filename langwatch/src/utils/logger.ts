import pino, { type LoggerOptions } from "pino";
import { getContext } from "../server/context/contextProvider";

const isBrowser = typeof window !== "undefined";
const isNodeDev = !isBrowser && process.env.NODE_ENV !== "production";

let pinoPretty: any;
if (isNodeDev) {
  try {
    pinoPretty = require("pino-pretty");
  } catch (e) {
    console.error("Failed to load pino-pretty for server-side logging:", e);
  }
}

const getDestinationStream = () => {
  if (isNodeDev && pinoPretty) return pinoPretty({ colorize: true });
  if (!isBrowser) return process.stdout;
  return void 0;
};

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
 * By default, the logger automatically includes request context (traceId, spanId,
 * organizationId, projectId, userId) in all log entries when available via
 * AsyncLocalStorage. This enables automatic trace correlation.
 *
 * @param name - Logger name (e.g., "langwatch:api:hono")
 * @param options - Optional configuration
 * @param options.disableContext - Set to true to disable automatic context injection
 */
export const createLogger = (name: string, options?: CreateLoggerOptions) => {
  const pinoOptions: LoggerOptions = {
    name,
    level: isBrowser
      ? "info"
      : (process.env.PINO_LOG_LEVEL ?? process.env._LOG_LEVEL ?? "info"),
    timestamp: isBrowser ? undefined : pino.stdTimeFunctions.isoTime,
    browser: isBrowser ? { asObject: true } : void 0,
    serializers: {
      error: pino.stdSerializers.err,
    },
    formatters: {
      bindings: (bindings) => {
        return bindings; // TODO(afr): Later, add git commit hash, and other stuff for production Node.js
      },
      level: (label) => {
        return { level: label.toUpperCase() };
      },
    },
  };

  const destination = getDestinationStream();
  const baseLogger = (pino as any).default(pinoOptions, destination) as ReturnType<typeof pino>;

  // If context is disabled or we're in browser, return the base logger
  if (options?.disableContext || isBrowser) {
    return baseLogger;
  }

  // Return a wrapper that automatically includes context
  return {
    info: (data: Record<string, unknown>, msg: string) => {
      baseLogger.info({ ...data, ...getContext() }, msg);
    },
    error: (data: Record<string, unknown>, msg: string) => {
      baseLogger.error({ ...data, ...getContext() }, msg);
    },
    warn: (data: Record<string, unknown>, msg: string) => {
      baseLogger.warn({ ...data, ...getContext() }, msg);
    },
    debug: (data: Record<string, unknown>, msg: string) => {
      baseLogger.debug({ ...data, ...getContext() }, msg);
    },
    trace: (data: Record<string, unknown>, msg: string) => {
      baseLogger.trace({ ...data, ...getContext() }, msg);
    },
    fatal: (data: Record<string, unknown>, msg: string) => {
      baseLogger.fatal({ ...data, ...getContext() }, msg);
    },
    // Expose child for cases where it's needed
    child: baseLogger.child.bind(baseLogger),
    // Expose level for compatibility
    level: baseLogger.level,
  } as ReturnType<typeof pino>;
};

export type Logger = ReturnType<typeof createLogger>;
