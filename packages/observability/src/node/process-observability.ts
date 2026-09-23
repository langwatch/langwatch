import { getLangWatchTracer } from "langwatch";
import {
  setupObservability,
  type ObservabilityHandle,
  type SetupObservabilityOptions,
} from "langwatch/observability/node";

import { createLogger, type Logger } from "../logger.ts";
import { UnexportedSpanProcessor } from "./unexported-spans.ts";

type SetupOptions = Omit<SetupObservabilityOptions, "debug" | "serviceName">;

interface SdkLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * The process-owned observability graph, constructed once at boot and
 * injected into adapters that need its logger/tracer. HTTP and queue spans
 * still come from API/Eventing instrumentation; this owns their provider and shutdown boundary.
 */
export interface ProcessObservability {
  readonly logger: Logger;
  readonly tracer: ReturnType<typeof getLangWatchTracer>;
  shutdown(): Promise<void>;
}

/**
 * A process-owned telemetry signal that shares the process shutdown boundary
 * with tracing. This keeps independently configured signals, such as a
 * profiler, behind typed composition rather than their own signal handlers.
 */
export interface ProcessObservabilityFlusher {
  readonly name: string;
  shutdown(): Promise<void>;
}

export interface ProcessObservabilityOptions {
  /** Semantic process identity, also used as the tracer name. */
  serviceName: string;
  /** Optional logger label for process boot and composition messages. */
  loggerName?: string;
  /** Typed SDK setup supplied by the process configuration root. */
  setup?: SetupOptions;
  /**
   * Extra process-owned telemetry signals, flushed after the SDK. Metric
   * readers belong in `setup`; this seam is for independently managed signals
   * such as continuous profiling.
   */
  flushers?: readonly ProcessObservabilityFlusher[];
  /**
   * A graph another caller in this process already built. When set, it is
   * returned unchanged — the SDK's tracer provider can be set up only once
   * per process, so a launcher hosting several graphs builds it once here.
   */
  sharedHandle?: ProcessObservability;
}

/**
 * Creates the one Node logger/tracer graph for a process. `setupObservability`
 * gets the Pino logger via its diagnostic port, with automatic SDK signal
 * handlers disabled so lifecycles can drain their own work before `shutdown`.
 */
export function createProcessObservability(
  options: ProcessObservabilityOptions,
): ProcessObservability {
  if (options.sharedHandle) return options.sharedHandle;

  const logger = createLogger(options.loggerName ?? `langwatch:${options.serviceName}`);
  const sdkLogger = createSdkLogger(logger);
  const sdkHandle = setupObservability({
    ...options.setup,
    serviceName: options.serviceName,
    debug: {
      logger: sdkLogger,
    },
    ...(recordsSpansAndExportsNothing(options.setup)
      ? { spanProcessors: [new UnexportedSpanProcessor()] }
      : {}),
    advanced: {
      ...options.setup?.advanced,
      disableAutoShutdown: true,
    },
  });
  const tracer = getLangWatchTracer(options.serviceName);

  let closing: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    closing ??= shutdownObservability(sdkHandle, options.flushers ?? []);
    return closing;
  };

  return { logger, tracer, shutdown };
}

/** Whether spans are recorded but not exported (local dev mode). */
function recordsSpansAndExportsNothing(setup: SetupOptions | undefined): boolean {
  return (
    setup?.langwatch === "disabled" &&
    setup.traceExporter === undefined &&
    !setup.spanProcessors?.length
  );
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

async function shutdownObservability(
  handle: ObservabilityHandle,
  flushers: readonly ProcessObservabilityFlusher[],
): Promise<void> {
  let firstError: unknown;

  try {
    await handle.shutdown();
  } catch (error) {
    firstError = error;
  }

  for (const flusher of flushers) {
    try {
      await flusher.shutdown();
    } catch (error) {
      firstError ??= error;
    }
  }

  if (firstError) throw firstError;
}
