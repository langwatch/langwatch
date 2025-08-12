import { NodeSDK } from "@opentelemetry/sdk-node";
import { SimpleLogRecordProcessor, BatchLogRecordProcessor, type LogRecordProcessor, ConsoleLogRecordExporter, LoggerProvider } from "@opentelemetry/sdk-logs";
import { createMergedResource, isConcreteProvider } from "../utils";
import { type SetupObservabilityOptions, type ObservabilityHandle } from "./types";
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

// Helper functions
const createNoOpHandle = (logger: Logger): ObservabilityHandle => ({
  shutdown: async () => {
    logger.debug("Shutdown called for LangWatch no-op. Nothing will be shutdown");
  },
});

const getLangWatchConfig = (options: SetupObservabilityOptions) => {
  const isDisabled = options.langwatch === 'disabled';
  const config = typeof options.langwatch === 'object' ? options.langwatch : {};

  return {
    disabled: isDisabled,
    apiKey: isDisabled ? void 0 : (config.apiKey ?? process.env.LANGWATCH_API_KEY),
    endpoint: isDisabled ? void 0 : (config.endpoint ?? process.env.LANGWATCH_ENDPOINT ?? 'https://api.langwatch.ai'),
    processorType: config.processorType ?? 'simple'
  };
};

const checkForEarlyExit = (options: SetupObservabilityOptions, logger: Logger): ObservabilityHandle | null => {
  if (options.advanced?.disabled) {
    logger.debug("Observability disabled via advanced.disabled");
    return createNoOpHandle(logger);
  }

  if (options.advanced?.skipOpenTelemetrySetup) {
    logger.debug("Skipping OpenTelemetry setup");
    return createNoOpHandle(logger);
  }

  const globalProvider = trace.getTracerProvider();
  const alreadySetup = isConcreteProvider(globalProvider);

  if (alreadySetup && !options.advanced?.UNSAFE_forceOpenTelemetryReinitialization) {
    logger.error(
      `OpenTelemetry is already set up in this process.\n` +
        `Spans will NOT be sent to LangWatch unless you add the LangWatch span processor or exporter to your existing OpenTelemetry setup.\n` +
        `You must either:\n` +
        `  1. Remove your existing OpenTelemetry setup and only use LangWatch,\n` +
        `  2. Add the LangWatch span processor to your existing setup, or replace the existing exporter with the LangWatch exporter.\n` +
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

export function setupObservability(options: SetupObservabilityOptions = {}): ObservabilityHandle {
  const logger = options.debug?.logger ?? new ConsoleLogger({
    level: options.debug?.logLevel ?? 'warn',
    prefix: "LangWatch Observability SDK",
  });

  initializeObservabilitySdkConfig({
    logger,
    dataCapture: options.dataCapture,
  });

  const earlyExit = checkForEarlyExit(options, logger);
  if (earlyExit) return earlyExit;

  try {
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

export function createAndStartNodeSdk(
  options: SetupObservabilityOptions,
  logger: Logger,
  resource: Resource,
): NodeSDK {
  const langwatch = getLangWatchConfig(options);

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
    logProcessors.push(new SimpleLogRecordProcessor(new ConsoleLogRecordExporter()));
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
      logProcessors.push(new BatchLogRecordProcessor(logExporter));
      logger.debug(`Added LangWatch ${langwatch.processorType} SpanProcessor and LogRecordProcessor to SDK`);
    } else {
      spanProcessors.push(new SimpleSpanProcessor(traceExporter));
      logProcessors.push(new SimpleLogRecordProcessor(logExporter));
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

  if (loggerProvider) {
    setLangWatchLoggerProvider(loggerProvider);
    logger.debug("Set LangWatch logger provider");
  }

  if (!options.advanced?.disableAutoShutdown) {
    process.on('SIGTERM', () => {
      void (async () => {
        logger.debug('SIGTERM received: shutting down OpenTelemetry...');
        try {
          await sdk.shutdown();
          logger.debug('OpenTelemetry shutdown complete');
        } catch (err) {
          logger.error('Error shutting down OpenTelemetry', err);
        } finally {
          process.exit(0);
        }
      })();
    });
  }

  return sdk;
}
