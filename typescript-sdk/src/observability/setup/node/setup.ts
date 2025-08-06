import { NodeSDK } from "@opentelemetry/sdk-node";
import { createMergedResource, isConcreteProvider } from "../utils";
import { SetupObservabilityOptions, ObservabilityHandle } from "./types";
import { trace } from "@opentelemetry/api";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { Resource } from "@opentelemetry/resources";
import { LangWatchExporter } from "../../exporters";
import { ConsoleLogger, Logger } from "../../../logger";
import { setObservabilityConfig } from "../config";

export function setupObservability(
  options: SetupObservabilityOptions = {},
): ObservabilityHandle {
  const logger = options.logger ?? new ConsoleLogger({
    level: options.logLevel,
    prefix: "LangWatch Observability",
  });
  setObservabilityConfig({ logger });

  if (options.skipOpenTelemetrySetup) {
    logger.debug("Skipping OpenTelemetry setup");
    return {
      shutdown: async () => {},
    };
  }

  const globalProvider = trace.getTracerProvider();
  const alreadySetup = isConcreteProvider(globalProvider);

  // If a global provider is already set, do not allow patching or re-initialization.
  if (alreadySetup) {
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

  logger.info("No existing TracerProvider; initializing NodeSDK");

  try {
    const mergedResource = createMergedResource(
      options.attributes,
      options.serviceName,
      options.resource,
    );
    const sdk = createAndStartNodeSdk(options, logger, mergedResource);
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

  const exporter =
    options.traceExporter ||
    new LangWatchExporter({
      apiKey: options.apiKey,
      endpoint: options.endpoint,
    });
  const processors: SpanProcessor[] = [];

  if (options.consoleTracing) {
    logger.debug("Console tracing enabled; adding console span exporter");
    processors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  if (options.spanProcessors?.length) {
    options.spanProcessors.forEach((sp) => {
      processors.push(sp);
      logger.debug("User SpanProcessor added to SDK");
    });
    logger.debug(
      `Added ${options.spanProcessors.length} user SpanProcessors to SDK`,
    );
  } else {
    processors.push(new BatchSpanProcessor(exporter));
    logger.debug("Added BatchSpanProcessor to SDK");
  }

  const sdk = new NodeSDK({
    resource,
    serviceName: options.serviceName,
    autoDetectResources: options.autoDetectResources,
    contextManager: options.contextManager,
    textMapPropagator: options.textMapPropagator,
    logRecordProcessors: options.logRecordProcessors,
    metricReader: options.metricReader,
    views: options.views,
    resourceDetectors: options.resourceDetectors,
    sampler: options.sampler,
    spanProcessors: processors,
    spanLimits: options.spanLimits,
    idGenerator: options.idGenerator,
    traceExporter: exporter,
    instrumentations: options.instrumentations,
  });

  sdk.start();
  logger.debug("NodeSDK started successfully");

  return sdk;
}
