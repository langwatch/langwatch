import { NodeSDK } from "@opentelemetry/sdk-node";
import { SimpleLogRecordProcessor, BatchLogRecordProcessor, LogRecordProcessor, ConsoleLogRecordExporter, LoggerProvider } from "@opentelemetry/sdk-logs";
import { createMergedResource, isConcreteProvider } from "../utils";
import { SetupObservabilityOptions, ObservabilityHandle } from "./types";
import { trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { Resource } from "@opentelemetry/resources";
import { LangWatchExporter, LangWatchLogsExporter } from "../../exporters";
import { ConsoleLogger, Logger } from "../../../logger";
import { initializeObservabilitySdkConfig } from "../../config";
import { setLangWatchLoggerProvider } from "../../logger";

export function setupObservability(
  options: SetupObservabilityOptions = {},
): ObservabilityHandle {
  const logger = options.logger ?? new ConsoleLogger({
    level: options.logLevel,
    prefix: "LangWatch Observability",
  });
  initializeObservabilitySdkConfig({
    logger,
    dataCapture: options.dataCapture,
  });

  if (options.skipOpenTelemetrySetup) {
    logger.debug("Skipping OpenTelemetry setup");
    return {
      shutdown: async () => {},
    };
  }

  const globalProvider = trace.getTracerProvider();
  const alreadySetup = isConcreteProvider(globalProvider);

  // If a global provider is already set, do not allow patching or re-initialization.
  // Unless UNSAFE_forceOpenTelemetryReinitialization is explicitly set to true (primarily for testing)
  if (alreadySetup && !options.UNSAFE_forceOpenTelemetryReinitialization) {
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

    return {
      shutdown: async () => {
        logger.debug(
          "Shutdown called for LangWatch no-op. Nothing will be shutdown",
        );
      },
    };
  }

  if (alreadySetup && options.UNSAFE_forceOpenTelemetryReinitialization) {
    logger.warn(
      "OpenTelemetry is already set up, but UNSAFE_forceOpenTelemetryReinitialization=true. " +
      "Proceeding with reinitialization. This may cause conflicts."
    );
  }

  logger.info("No existing TracerProvider; initializing NodeSDK");

  try {
    const sdk = createAndStartNodeSdk(options, logger, createMergedResource(
      options.attributes,
      options.serviceName,
      options.resource,
    ));

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

    if (options.throwOnSetupError) {
      throw err;
    }

    return {
      shutdown: async () => {
        logger.debug(
          "Shutdown called for LangWatch no-op. Nothing will be shutdown",
        );
      },
    };
  }
}

export function createAndStartNodeSdk(
  options: SetupObservabilityOptions,
  logger: Logger,
  resource: Resource,
): NodeSDK {
  if (options.traceExporter) {
    logger.debug("Using provided TraceExporter for SDK");
  } else {
    logger.debug("Using LangWatch TraceExporter for SDK");
  }

  const tracerExporter =
    options.traceExporter ||
    new LangWatchExporter({
      apiKey: options.apiKey,
      endpoint: options.endpoint,
    });

  const spanProcessors: SpanProcessor[] = [];
  const logProcessors: LogRecordProcessor[] = [];

  if (options.consoleTracing) {
    logger.debug("Console tracing enabled; adding console span exporter");
    spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }
  if (options.consoleLogging) {
    logger.debug("Console recording of logs enabled; adding console log record processor");
    logProcessors.push(new SimpleLogRecordProcessor(new ConsoleLogRecordExporter()));
  }

  if (options.spanProcessors?.length) {
    options.spanProcessors.forEach((sp) => {
      spanProcessors.push(sp);
      logger.debug("User SpanProcessor added to SDK");
    });
    logger.debug(
      `Added ${options.spanProcessors.length} user SpanProcessors to SDK`,
    );
  } else {
    spanProcessors.push(new BatchSpanProcessor(tracerExporter));
    logger.debug("Added BatchSpanProcessor to SDK");
  }

  if (options.logRecordProcessors?.length) {
    options.logRecordProcessors.forEach((lp) => {
      logProcessors.push(lp);
      logger.debug("User LogRecordProcessor added to SDK");
    });
    logger.debug(`Added ${options.logRecordProcessors.length} user LogRecordProcessors to SDK`);
  } else {
    logProcessors.push(new BatchLogRecordProcessor(new LangWatchLogsExporter({
      apiKey: options.apiKey,
      endpoint: options.endpoint,
    })));
    logger.debug("Added BatchLogRecordProcessor to SDK");
  }

  // When custom span processors are provided, don't set traceExporter to avoid conflicts
  const useCustomProcessors = options.spanProcessors?.length || options.consoleTracing;

  let loggerProvider: LoggerProvider | undefined;
  if (logProcessors.length) {
    loggerProvider = new LoggerProvider({
      resource,
      processors: logProcessors,
    });
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
    spanProcessors: spanProcessors,
    logRecordProcessors: logProcessors,
    spanLimits: options.spanLimits,
    idGenerator: options.idGenerator,
    // Only set traceExporter when not using custom span processors
    ...(useCustomProcessors ? {} : { traceExporter: tracerExporter }),
    instrumentations: options.instrumentations,
  });

  sdk.start();
  logger.debug("NodeSDK started successfully");

  // Set the logger provider for LangWatch logging
  if (loggerProvider) {
    setLangWatchLoggerProvider(loggerProvider);
    logger.debug("Set LangWatch logger provider");
  }

  return sdk;
}
