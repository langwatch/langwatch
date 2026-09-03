import { getLangWatchTracer } from "langwatch";
import {
  setupObservability,
  type ObservabilityHandle,
  type SetupObservabilityOptions,
} from "langwatch/observability/node";
import { createLogger, type Logger } from "../logger";
import { UnexportedSpanProcessor } from "./unexported-spans";

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

/**
 * Whether this process has been configured to record spans and send them
 * nowhere — the shape of every local `pnpm dev` lane, which has no LangWatch
 * credentials and no exporter of its own.
 *
 * Told to the SDK rather than left to it, because the SDK cannot tell that
 * shape apart from a deployment whose exporter was forgotten and used to write
 * a nine-line ERROR on every boot of every lane on the strength of it.
 */
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
