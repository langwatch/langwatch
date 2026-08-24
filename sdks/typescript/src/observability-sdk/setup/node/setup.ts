import { NodeSDK } from "@opentelemetry/sdk-node";
import { SimpleLogRecordProcessor, BatchLogRecordProcessor, type LogRecordProcessor, ConsoleLogRecordExporter, LoggerProvider } from "@opentelemetry/sdk-logs";
import { createMergedResource, getConcreteProvider, isConcreteProvider } from "../utils";
import { type SetupObservabilityOptions, type ObservabilityHandle, LANGWATCH_DISABLED } from "./types";
import { trace } from "@opentelemetry/api";
import {
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  BatchSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { type Resource } from "@opentelemetry/resources";
import { LangWatchLogsExporter, LangWatchTraceExporter } from "../../exporters";
import { ConsoleLogger, type Logger } from "../../../logger";
import { initializeObservabilitySdkConfig } from "../../config";
import { setLangWatchLoggerProvider } from "../../logger";
import { resolveEndpoint } from "@/internal/endpoint";
import { registerInstrumentations } from "@opentelemetry/instrumentation";

// Helper functions
const createNoOpHandle = (logger: Logger): ObservabilityHandle => ({
  shutdown: async () => {
    logger.debug("Shutdown called for LangWatch no-op. Nothing will be shutdown");
  },
});

/**
 * The three keys the options object is made of. A value carrying one of them is
 * a request to configure the exporter whatever it was constructed from.
 */
const LANGWATCH_OPTION_KEYS = ["apiKey", "endpoint", "processorType"] as const;

/**
 * Whether `value` can be read as the options object.
 *
 * A plain record is the ordinary case: an object literal, a JSON payload, a
 * spread, `Object.create(null)`. Everything else has to earn it by carrying at
 * least one option key, which keeps a configuration built by a class working
 * while `new Date()`, `new Map()`, `new Set()`, a regular expression and a
 * boxed string are turned away. None of those carries a key, so each one used
 * to read as an empty configuration and export on the environment's API key,
 * which is the same hole as the array by a different route.
 *
 * An empty `{}` stays valid: it is the documented way to say "configure me from
 * the environment", so emptiness on its own cannot be the signal.
 */
const isLangWatchOptions = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype === Object.prototype || prototype === null) return true;
  return LANGWATCH_OPTION_KEYS.some((key) => key in value);
};

/**
 * Names the KIND of a rejected value, never its contents.
 *
 * The contents cannot be logged. `langwatch: process.env.LANGWATCH_API_KEY` is
 * an easy thing to write by mistake, and a report that echoed the value would
 * put the API key in the application's logs, turning a misconfiguration into a
 * credential leak. The kind is enough to act on, because the message names the
 * one string the option accepts right beside it.
 *
 * Reading `constructor` can throw on a proxy, and this runs on the path that
 * exists to explain a problem, so it must not become one.
 */
const describeRejectedValue = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value !== "object") return `a ${typeof value}`;

  try {
    const name = (value as { constructor?: { name?: string } }).constructor?.name;
    return name && name !== "Object" ? `a ${name}` : "an object";
  } catch {
    return "an object";
  }
};

/**
 * Whether `langwatch` names the disable sentinel, an options object, or neither.
 *
 * The third case is why this exists. `langwatch: "disable"` used to satisfy
 * neither branch of the old two-line resolution: it is not the sentinel, so it
 * did not disable, and `typeof` said `string`, so it fell to `{}` and the
 * exporter came up on the environment's API key. A caller who asked to send
 * nothing sent everything, and nothing said so. TypeScript rejects that typo,
 * but this value routinely arrives from config, JSON or plain JavaScript, where
 * nothing does.
 *
 * `null` was the same shape of hole from the other side: `typeof null` is
 * `"object"`, so it reached the property reads below and threw a TypeError
 * naming neither the option nor the value. Every other non-record object was
 * the same hole again, by a longer route: an array, a `Date`, a `Map`, a
 * regular expression and a boxed string all read as a configuration whose
 * every field was `undefined`, so the API key fell through to the environment
 * and the exporter came up. `isLangWatchOptions` is what turns those away.
 *
 * An unrecognised value is treated as disabled rather than guessed at. It is the
 * only safe reading: every value that lands here is a caller who did not
 * successfully ask for the exporter, and exporting anyway is the failure worth
 * avoiding. It is reported at `error`, and setup's existing "disabled with no
 * alternative exporter" guidance then explains what to do next.
 */
const resolveLangWatchOption = (
  langwatch: SetupObservabilityOptions["langwatch"],
  logger: Logger,
): { disabled: boolean; config: Exclude<typeof langwatch, string | undefined> } => {
  if (langwatch === void 0 || langwatch === LANGWATCH_DISABLED) {
    return { disabled: langwatch === LANGWATCH_DISABLED, config: {} };
  }

  if (
    typeof langwatch === "object" &&
    langwatch !== null &&
    !Array.isArray(langwatch) &&
    isLangWatchOptions(langwatch)
  ) {
    return { disabled: false, config: langwatch };
  }

  logger.error(
    `Invalid \`langwatch\` option: got ${describeRejectedValue(langwatch)}.\n` +
      `Expected an options object, or "${LANGWATCH_DISABLED}" to turn the integration off.\n` +
      `Treating it as "${LANGWATCH_DISABLED}", because a value that is neither cannot be read as a request to export.`,
  );
  return { disabled: true, config: {} };
};

const getLangWatchConfig = (options: SetupObservabilityOptions, logger: Logger) => {
  const { disabled: isDisabled, config } = resolveLangWatchOption(options.langwatch, logger);

  return {
    disabled: isDisabled,
    apiKey: isDisabled ? void 0 : (config.apiKey ?? process.env.LANGWATCH_API_KEY),
    endpoint: isDisabled ? void 0 : resolveEndpoint(config.endpoint),
    processorType: config.processorType ?? 'batch'
  };
};

const checkForEarlyExit = (options: SetupObservabilityOptions, logger: Logger): ObservabilityHandle | null => {
  const globalProvider = trace.getTracerProvider();
  const alreadySetup = isConcreteProvider(globalProvider);

  if (alreadySetup && !options.advanced?.UNSAFE_forceOpenTelemetryReinitialization) {
    if (options.advanced?.attachToExistingProvider) {
      return null;
    }

    logger.error(
      `OpenTelemetry is already set up in this process.\n` +
        `Spans will NOT be sent to LangWatch unless you add the LangWatch span processor or exporter to your existing OpenTelemetry setup.\n` +
        `You must either:\n` +
        `  1. Remove your existing OpenTelemetry setup and only use LangWatch,\n` +
        `  2. Add the LangWatch span processor to your existing setup, or replace the existing exporter with the LangWatch exporter.\n` +
        `  3. Use advanced.attachToExistingProvider to let LangWatch attach its processors to the existing provider.\n` +
        `\nFor step-by-step instructions, see the LangWatch docs and check out the integration guide for your framework:\n` +
        `  https://docs.langwatch.ai/integration/typescript/guide\n` +
        `\nSee also: https://github.com/open-telemetry/opentelemetry-js/issues/5299`,
    );
    return createNoOpHandle(logger);
  }

  if (alreadySetup) {
    logger.warn(
      "OpenTelemetry is already set up, but UNSAFE_forceOpenTelemetryReinitialization=true. " +
      "Proceeding with reinitialization. This may cause conflicts."
    );
  }

  return null;
};

const warnIfMisconfigured = (options: SetupObservabilityOptions, langwatch: ReturnType<typeof getLangWatchConfig>, logger: Logger) => {
  // Check if LangWatch is disabled but no alternative export mechanisms are provided
  // Note: If we reach this function, we know advanced.disabled and advanced.skipOpenTelemetrySetup are false
  // because those are handled as early exits in setupObservability()
  if (langwatch.disabled) {
    const hasAlternativeExport =
      options.spanProcessors?.length ??
      options.logRecordProcessors?.length ??
      options.debug?.consoleTracing ??
      options.debug?.consoleLogging ??
      options.traceExporter;

    if (!hasAlternativeExport) {
      const errorMessage =
        "LangWatch integration is disabled but no custom span processors, trace exporters, or console tracing is configured. " +
        "OpenTelemetry will be set up but traces will not be exported anywhere. " +
        "Either:\n" +
        "  1. Enable LangWatch integration (remove langwatch: 'disabled')\n" +
        "  2. Provide custom spanProcessors, logRecordProcessors, or traceExporter\n" +
        "  3. Enable debug.consoleTracing or debug.consoleLogging for development\n" +
        "  4. Use advanced.disabled to completely disable observability\n" +
        "  5. Use advanced.skipOpenTelemetrySetup to handle OpenTelemetry setup yourself";

      if (options.advanced?.throwOnSetupError) {
        throw new Error(errorMessage);
      } else {
        logger.error(errorMessage);
      }
    }
  }
};

type TerminationSignal = "SIGINT" | "SIGTERM";

/**
 * Registers the flush-on-exit handlers that back `advanced.disableAutoShutdown`.
 *
 * Observability tooling must never terminate its host. Node runs *every* listener
 * registered for a termination signal, so an SDK that calls `process.exit()` when its
 * own flush finishes ends the process out from under everybody else's: a host draining
 * a queue, finishing in-flight database writes or closing connections loses the rest of
 * its shutdown a second or two in. So the handlers below flush and then hand the
 * decision about the process back to whoever else is listening.
 *
 * That leaves one case to protect. A signal that has at least one listener no longer
 * performs Node's default action, so a bare "flush and do nothing" would silently
 * neuter Ctrl+C for a one-shot script whose only listener is ours. The two candidate
 * fixes were (a) keep exiting but only when we installed the sole listener, and (b) drop
 * the exit entirely and accept that such a script hangs. Neither is quite right: (a)
 * still reports a success status for a process that was signalled, and (b) regresses
 * every CLI that uses the SDK. So we do neither literally — after flushing we remove our
 * own listeners and, if that leaves the signal with no listeners at all, re-raise the
 * same signal at ourselves. Node then applies the default action and the process ends
 * exactly as it would have without the SDK loaded, reporting the signal (128+n) instead
 * of the `process.exit(0)` this code used to fake. Removing our listeners first is also
 * what makes the count trustworthy when several SDK instances are registered: each one
 * drops out as it finishes, and only the last one out re-raises.
 */
const registerAutoShutdownHandlers = ({
  sdk,
  logger,
  exitProcessAfterShutdown,
}: {
  sdk: NodeSDK;
  logger: Logger;
  exitProcessAfterShutdown: boolean;
}): void => {
  let isShuttingDown = false;
  const registrations: { event: "beforeExit" | TerminationSignal; handler: () => void }[] = [];

  const register = (event: "beforeExit" | TerminationSignal, handler: () => void) => {
    registrations.push({ event, handler });
    process.on(event, handler);
  };

  // Our handlers are one-shot: once a shutdown has begun there is nothing left for them
  // to do, and staying registered would keep the process from ever seeing the default
  // disposition of a repeated signal.
  const unregisterAll = () => {
    for (const { event, handler } of registrations) {
      process.removeListener(event, handler);
    }
    registrations.length = 0;
  };

  const flush = async (reason: string): Promise<void> => {
    logger.debug(`${reason}: shutting down OpenTelemetry...`);
    try {
      await sdk.shutdown();
      logger.debug("OpenTelemetry shutdown complete");
    } catch (err) {
      logger.error("Error shutting down OpenTelemetry", err);
    }
  };

  const beginShutdown = (): boolean => {
    if (isShuttingDown) return false;
    isShuttingDown = true;
    unregisterAll();
    return true;
  };

  // Normal process exit when the event loop drains (e.g. CLI scripts, one-shot programs).
  // Nothing is terminating here, so there is nothing to re-raise or exit.
  register("beforeExit", () => {
    if (!beginShutdown()) return;
    void flush("beforeExit");
  });

  // Ctrl+C, and external kill / Docker stop / Kubernetes pod termination.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    register(signal, () => {
      if (!beginShutdown()) return;

      void flush(signal).then(() => {
        if (exitProcessAfterShutdown) {
          logger.debug(`${signal}: flush complete, exiting because UNSAFE_exitProcessAfterAutoShutdown is set`);
          process.exit(0);
          return;
        }

        const otherListenerCount = process.listenerCount(signal);
        if (otherListenerCount > 0) {
          logger.debug(
            `${signal}: flush complete, leaving the process to the ${otherListenerCount} other listener(s)`,
          );
          return;
        }

        logger.debug(`${signal}: flush complete and nothing else is listening, re-raising`);
        process.kill(process.pid, signal);
      });
    });
  }
};

export function setupObservability(options: SetupObservabilityOptions = {}): ObservabilityHandle {
  const logger = options.debug?.logger ?? new ConsoleLogger({
    level: options.debug?.logLevel ?? 'warn',
    prefix: "LangWatch Observability SDK",
  });

  initializeObservabilitySdkConfig({
    logger,
    dataCapture: options.dataCapture,
  });

  if (options.advanced?.disabled) {
    logger.debug("Observability disabled via advanced.disabled");
    return createNoOpHandle(logger);
  }

  if (options.advanced?.skipOpenTelemetrySetup) {
    logger.debug("Skipping OpenTelemetry setup");
    return createNoOpHandle(logger);
  }

  if (options.tracerProvider) {
    try {
      return setupDedicatedProvider(options.tracerProvider, options, logger);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to set up dedicated provider: ${errorMessage}`);
      if (options.advanced?.throwOnSetupError) throw err;
      return createNoOpHandle(logger);
    }
  }

  const earlyExit = checkForEarlyExit(options, logger);
  if (earlyExit) return earlyExit;

  try {
    const globalProvider = trace.getTracerProvider();
    const existingProvider = getConcreteProvider(globalProvider);

    if (options.advanced?.attachToExistingProvider && existingProvider) {
      const handle = attachToExistingProvider(existingProvider, options, logger);
      if (handle) return handle;

      const errorMsg =
        "attachToExistingProvider is enabled but the existing provider does not support adding span processors. " +
        "This may be due to an incompatible OpenTelemetry version. No spans will be exported to LangWatch.";
      if (options.advanced?.throwOnSetupError) throw new Error(errorMsg);
      logger.error(errorMsg);
      return createNoOpHandle(logger);
    }

    const sdk = createAndStartNodeSdk(options, logger, createMergedResource(
      options.attributes,
      options.serviceName,
      options.resource,
    ));

    logger.info("LangWatch Observability SDK setup completed successfully");

    return {
      shutdown: async () => {
        logger.debug("Shutting down NodeSDK");
        await sdk?.shutdown();
        logger.info("NodeSDK shutdown complete");
      },
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to initialize NodeSDK: ${errorMessage}`);

    if (err instanceof Error && err.stack) {
      logger.debug(`Stack trace: ${err.stack}`);
    }

    if (options.advanced?.throwOnSetupError) throw err;
    return createNoOpHandle(logger);
  }
}

function setupDedicatedProvider(
  provider: import("@opentelemetry/api").TracerProvider,
  options: SetupObservabilityOptions,
  logger: Logger,
): ObservabilityHandle {
  const langwatch = getLangWatchConfig(options, logger);
  const addedProcessors: SpanProcessor[] = [];

  const internalArray = (provider as any)?._activeSpanProcessor?._spanProcessors;
  const hasPublicApi = typeof (provider as any)?.addSpanProcessor === 'function';

  if (!Array.isArray(internalArray) && !hasPublicApi) {
    const msg = "Dedicated tracerProvider does not support adding span processors.";
    if (options.advanced?.throwOnSetupError) throw new Error(msg);
    logger.error(msg);
    return createNoOpHandle(logger);
  }

  const addProcessor = (processor: SpanProcessor) => {
    if (hasPublicApi) {
      (provider as any).addSpanProcessor(processor);
    } else {
      internalArray.push(processor);
    }
  };

  if (!langwatch.disabled) {
    const traceExporter = new LangWatchTraceExporter({
      apiKey: langwatch.apiKey,
      endpoint: langwatch.endpoint,
    });

    const processor = langwatch.processorType === 'batch'
      ? new BatchSpanProcessor(traceExporter)
      : new SimpleSpanProcessor(traceExporter);

    addedProcessors.push(processor);
    addProcessor(processor);
    logger.info("Attached LangWatch span processor to dedicated provider");
  }

  if (options.traceExporter) {
    const p = new SimpleSpanProcessor(options.traceExporter);
    addedProcessors.push(p);
    addProcessor(p);
  }

  if (options.spanProcessors?.length) {
    for (const p of options.spanProcessors) {
      addedProcessors.push(p);
      addProcessor(p);
    }
  }

  let unregisterInstrumentations: (() => void) | undefined;
  if (options.instrumentations?.length) {
    unregisterInstrumentations = registerInstrumentations({
      tracerProvider: provider,
      instrumentations: options.instrumentations,
    });
    logger.info(`Registered ${options.instrumentations.length} instrumentations against dedicated provider`);
  }

  logger.info("LangWatch Observability SDK setup completed with dedicated provider (trace-only, global provider untouched)");

  return {
    shutdown: async () => {
      logger.debug("Shutting down dedicated LangWatch processors");
      try {
        await Promise.all(addedProcessors.map((p) => p.shutdown()));
      } finally {
        const candidates = [
          (provider as any)?._activeSpanProcessor?._spanProcessors,
          (provider as any)?.activeSpanProcessor?._spanProcessors,
          (provider as any)?._registeredSpanProcessors,
        ];
        for (const arr of candidates) {
          if (!Array.isArray(arr)) continue;
          for (const p of addedProcessors) {
            const idx = arr.indexOf(p);
            if (idx !== -1) arr.splice(idx, 1);
          }
        }
        unregisterInstrumentations?.();
      }
      logger.info("LangWatch processor shutdown complete");
    },
  };
}

function attachToExistingProvider(
  provider: unknown,
  options: SetupObservabilityOptions,
  logger: Logger,
): ObservabilityHandle | null {
  const internalArray = (provider as any)?._activeSpanProcessor?._spanProcessors;
  const hasPublicApi = typeof (provider as any)?.addSpanProcessor === 'function';

  if (!Array.isArray(internalArray) && !hasPublicApi) {
    return null;
  }

  const addProcessor = (processor: SpanProcessor) => {
    if (hasPublicApi) {
      (provider as any).addSpanProcessor(processor);
    } else {
      internalArray.push(processor);
    }
  };

  const langwatch = getLangWatchConfig(options, logger);
  const addedProcessors: SpanProcessor[] = [];

  if (!langwatch.disabled) {
    const traceExporter = new LangWatchTraceExporter({
      apiKey: langwatch.apiKey,
      endpoint: langwatch.endpoint,
    });

    const processor = langwatch.processorType === 'batch'
      ? new BatchSpanProcessor(traceExporter)
      : new SimpleSpanProcessor(traceExporter);

    addedProcessors.push(processor);
    addProcessor(processor);
    logger.info("Attached LangWatch span processor to existing global provider");
  }

  if (options.traceExporter) {
    const traceExporterProcessor = new SimpleSpanProcessor(options.traceExporter);
    addedProcessors.push(traceExporterProcessor);
    addProcessor(traceExporterProcessor);
    logger.debug("Attached user-provided traceExporter to existing provider");
  }

  if (options.spanProcessors?.length) {
    for (const processor of options.spanProcessors) {
      addedProcessors.push(processor);
      addProcessor(processor);
    }
    logger.debug(`Attached ${options.spanProcessors.length} user-provided span processors to existing provider`);
  }

  return {
    shutdown: async () => {
      logger.debug("Shutting down attached LangWatch processors");
      try {
        await Promise.all(addedProcessors.map((p) => p.shutdown()));
      } finally {
        const candidates = [
          (provider as any)?._activeSpanProcessor?._spanProcessors,
          (provider as any)?.activeSpanProcessor?._spanProcessors,
          (provider as any)?._registeredSpanProcessors,
        ];
        for (const arr of candidates) {
          if (!Array.isArray(arr)) continue;
          for (const p of addedProcessors) {
            const idx = arr.indexOf(p);
            if (idx !== -1) arr.splice(idx, 1);
          }
        }
      }
      logger.info("LangWatch processor shutdown complete");
    },
  };
}

export function createAndStartNodeSdk(
  options: SetupObservabilityOptions,
  logger: Logger,
  resource: Resource,
): NodeSDK {
  const langwatch = getLangWatchConfig(options, logger);

  if (langwatch.disabled) {
    logger.warn("LangWatch integration disabled, using user-provided SpanProcessors and LogRecordProcessors");
  } else {
    logger.info(`Using LangWatch ${langwatch.processorType} processors for tracing and logging`);
  }

  const spanProcessors: SpanProcessor[] = [];
  const logProcessors: LogRecordProcessor[] = [];

  // Console processors
  if (options.debug?.consoleTracing) {
    spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
    logger.debug("Console tracing enabled; adding console span exporter");
  }
  if (options.debug?.consoleLogging) {
    logProcessors.push(
      new SimpleLogRecordProcessor({ exporter: new ConsoleLogRecordExporter() }),
    );
    logger.debug("Console recording of logs enabled; adding console log record processor");
  }

  if (!langwatch.disabled) {
    const traceExporter = new LangWatchTraceExporter({
      apiKey: langwatch.apiKey,
      endpoint: langwatch.endpoint,
    });
    const logExporter = new LangWatchLogsExporter({
      apiKey: langwatch.apiKey,
      endpoint: langwatch.endpoint,
    });

    if (langwatch.processorType === 'batch') {
      spanProcessors.push(new BatchSpanProcessor(traceExporter));
      logProcessors.push(new BatchLogRecordProcessor({ exporter: logExporter }));
      logger.debug(`Added LangWatch ${langwatch.processorType} SpanProcessor and LogRecordProcessor to SDK`);
    } else {
      spanProcessors.push(new SimpleSpanProcessor(traceExporter));
      logProcessors.push(new SimpleLogRecordProcessor({ exporter: logExporter }));
      logger.debug(`Added LangWatch ${langwatch.processorType} SpanProcessor and LogRecordProcessor to SDK`);
    }
  }

  if (options.traceExporter) {
    spanProcessors.push(new SimpleSpanProcessor(options.traceExporter));
    logger.debug(`Added user-provided SpanProcessor to SDK`);
  }

  if (options.spanProcessors?.length) {
    spanProcessors.push(...options.spanProcessors);
    logger.debug(`Added user-provided ${options.spanProcessors.length} SpanProcessors to SDK`);
  }
  if (options.logRecordProcessors?.length) {
    logProcessors.push(...options.logRecordProcessors);
    logger.debug(`Added user-provided ${options.logRecordProcessors.length} LogRecordProcessors to SDK`);
  }

  warnIfMisconfigured(options, langwatch, logger);

  // Create logger provider
  const loggerProvider = logProcessors.length ? new LoggerProvider({
    resource,
    processors: logProcessors,
  }) : void 0;

  if (loggerProvider) {
    logger.debug("Created LangWatch logger provider");
  }

  const sdk = new NodeSDK({
    resource,
    serviceName: options.serviceName,
    autoDetectResources: options.autoDetectResources,
    contextManager: options.contextManager,
    textMapPropagator: options.textMapPropagator,
    metricReader: options.metricReader,
    views: options.views,
    resourceDetectors: options.resourceDetectors,
    sampler: options.sampler,
    spanProcessors,
    logRecordProcessors: logProcessors,
    spanLimits: options.spanLimits,
    idGenerator: options.idGenerator,
    instrumentations: options.instrumentations,
  });

  sdk.start();
  logger.info("NodeSDK started successfully");

  // Fix for Next.js 15: Explicitly verify and register provider if still proxy
  // See: https://github.com/langwatch/langwatch/issues/753
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Wait a tick to ensure SDK initialization completes
    setImmediate(() => {
      const globalProvider = trace.getTracerProvider();

      // Check if provider is still a proxy (Next.js 15 issue)
      if (globalProvider.constructor.name === 'ProxyTracerProvider') {
        logger.warn('Global provider is still ProxyTracerProvider after SDK start - applying Next.js 15 workaround');

        // Access the real provider from the delegate
        const realProvider = (globalProvider as any)._delegate;

        if (realProvider?.constructor.name === 'NodeTracerProvider') {
          // Explicitly register the real provider globally
          trace.setGlobalTracerProvider(realProvider);
          logger.info('Successfully registered NodeTracerProvider globally for Next.js 15');
        } else {
          logger.error('Could not find NodeTracerProvider in proxy delegate - spans may not be exported');
        }
      } else {
        logger.debug(`Provider registered correctly: ${globalProvider.constructor.name}`);
      }
    });
  }

  if (loggerProvider) {
    setLangWatchLoggerProvider(loggerProvider);
    logger.debug("Set LangWatch logger provider");
  }

  if (!options.advanced?.disableAutoShutdown) {
    registerAutoShutdownHandlers({
      sdk,
      logger,
      exitProcessAfterShutdown: options.advanced?.UNSAFE_exitProcessAfterAutoShutdown ?? false,
    });
  }

  return sdk;
}

/**
 * Ensure observability is set up, but only if not already configured.
 * 
 * This is an idempotent function that:
 * - Does nothing if OpenTelemetry is already configured (by you or another library)
 * - Sets up LangWatch observability if no tracer provider exists
 * - Does nothing if LANGWATCH_API_KEY is not set
 * 
 * This is useful for libraries/SDKs that want to ensure tracing is available
 * without conflicting with user's existing observability setup.
 * 
 * @example
 * ```typescript
 * import { ensureSetup } from "langwatch/observability/node";
 * 
 * // Safe to call - won't conflict with existing setup
 * ensureSetup();
 * 
 * // Now you can use tracing
 * const tracer = trace.getTracer("my-app");
 * ```
 */
export const ensureSetup = (): ObservabilityHandle => {
  const globalProvider = trace.getTracerProvider();
  const alreadySetup = isConcreteProvider(globalProvider);
  
  // If already set up, return no-op handle (don't log error, just silently skip)
  if (alreadySetup) {
    return {
      shutdown: async () => {
        // No-op - we didn't set up anything
      },
    };
  }
  
  // If no API key, return no-op handle (can't set up without it)
  if (!process.env.LANGWATCH_API_KEY) {
    return {
      shutdown: async () => {
        // No-op - no API key available
      },
    };
  }
  
  // Set up observability with defaults
  return setupObservability();
};
