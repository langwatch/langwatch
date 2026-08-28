import { getLangWatchTracer } from "langwatch";
import {
  setupObservability,
  type ObservabilityHandle,
  type SetupObservabilityOptions,
} from "langwatch/observability/node";
import { createLogger, type Logger } from "../logger";

type SetupOptions = Omit<SetupObservabilityOptions, "debug" | "serviceName">;

interface SdkLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * The process-owned observability graph.
 *
 * A process constructs this once during boot and injects its logger/tracer
 * into adapters that need them. HTTP and queue spans still come from the
 * existing API/Eventing instrumentation; this object owns their provider and
 * the one shutdown boundary that flushes it.
 */
export interface ProcessObservability {
  readonly logger: Logger;
  readonly tracer: ReturnType<typeof getLangWatchTracer>;
  shutdown(): Promise<void>;
}

export interface ProcessObservabilityOptions {
  /** Semantic process identity, also used as the tracer name. */
  serviceName: string;
  /** Optional logger label for process boot and composition messages. */
  loggerName?: string;
  /** Typed SDK setup supplied by the process configuration root. */
  setup?: SetupOptions;
}

/**
 * Creates the one Node logger/tracer graph for an application process.
 *
 * `setupObservability` is given the Pino logger through its diagnostic port,
 * and automatic SDK signal handlers are disabled so API/worker lifecycles can
 * drain their own work before calling `shutdown`. The setup options are passed
 * in by the composition root; this module deliberately does not read env.
 */
export function createProcessObservability(
  options: ProcessObservabilityOptions,
): ProcessObservability {
  const logger = createLogger(options.loggerName ?? `langwatch:${options.serviceName}`);
  const sdkLogger = createSdkLogger(logger);
  const sdkHandle = setupObservability({
    ...options.setup,
    serviceName: options.serviceName,
    debug: {
      logger: sdkLogger,
    },
    advanced: {
      ...options.setup?.advanced,
      disableAutoShutdown: true,
    },
  });
  const tracer = getLangWatchTracer(options.serviceName);

  let closing: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    closing ??= shutdownObservability(sdkHandle);
    return closing;
  };

  return { logger, tracer, shutdown };
}

function createSdkLogger(logger: Logger): SdkLogger {
  return {
    debug: (message, ...args) => writeDebug(logger, message, args),
    info: (message, ...args) => writeInfo(logger, message, args),
    warn: (message, ...args) => writeWarn(logger, message, args),
    error: (message, ...args) => writeError(logger, message, args),
  };
}

function writeDebug(logger: Logger, message: string, args: readonly unknown[]): void {
  if (args.length === 0) {
    logger.debug(message);
    return;
  }

  logger.debug({ sdkArgs: args }, message);
}

function writeInfo(logger: Logger, message: string, args: readonly unknown[]): void {
  if (args.length === 0) {
    logger.info(message);
    return;
  }

  logger.info({ sdkArgs: args }, message);
}

function writeWarn(logger: Logger, message: string, args: readonly unknown[]): void {
  if (args.length === 0) {
    logger.warn(message);
    return;
  }

  logger.warn({ sdkArgs: args }, message);
}

function writeError(logger: Logger, message: string, args: readonly unknown[]): void {
  if (args.length === 0) {
    logger.error(message);
    return;
  }

  logger.error({ sdkArgs: args }, message);
}

async function shutdownObservability(handle: ObservabilityHandle): Promise<void> {
  await handle.shutdown();
}
