import { trace, type TracerProvider } from "@opentelemetry/api";
import {
  BatchSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  type Resource,
} from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getLangWatchTracer } from "../../tracer";
import {
  LANGWATCH_TRACER_NAME,
  LANGWATCH_SDK_VERSION,
  isNoopProvider,
} from "../utils";
import { Logger } from "../../../logger";
import { SetupObservabilityOptions } from "./types";
import { LangWatchExporter } from "../../exporters";

let _langwatchTracer: ReturnType<typeof getLangWatchTracer> | undefined = void 0;

// Node-specific utilities
export function registerGlobalProvider(provider: TracerProvider, log: Logger): void {
  trace.setGlobalTracerProvider(provider);
  log.debug("Global tracer provider registered");
}

export function getGlobalProvider(): TracerProvider {
  return trace.getTracerProvider();
}

export function applyToProvider(
  provider: TracerProvider,
  options: SetupObservabilityOptions,
  log: Logger,
): void {
  if (isNoopProvider(provider)) {
    log.warn(
      "NoopTracerProvider detected, cannot add SpanProcessor: provider does not support addSpanProcessor (likely a no-op provider)",
    );
    return;
  }

  if (options.spanProcessors?.length) {
    options.spanProcessors.forEach((sp) => {
      (provider as any).addSpanProcessor(sp);
      log.debug("User SpanProcessor added to provider");
    });
    log.debug(
      `Added ${options.spanProcessors.length} user SpanProcessors to provider`,
    );
  } else {
    log.debug("No user SpanProcessors provided, adding BatchSpanProcessor");

    if (options.traceExporter) {
      log.debug("Adding BatchSpanProcessor with provided traceExporter");
    } else {
      log.debug("Adding BatchSpanProcessor with LangWatch exporter");
    }

    const exporter = options.traceExporter ?? new LangWatchExporter({
      apiKey: options.apiKey,
      endpoint: options.endpoint,
    });
    (provider as any).addSpanProcessor(new BatchSpanProcessor(exporter));
    log.debug("BatchSpanProcessor added to provider");
  }
}

export function createAndStartNodeSdk(
  options: SetupObservabilityOptions,
  log: Logger,
  resource: Resource,
): NodeSDK {
  if (options.traceExporter) {
    log.debug("Using provided TraceExporter for SDK");
  } else {
    log.debug("Using LangWatch TraceExporter for SDK");
  }

  const exporter = options.traceExporter || new LangWatchExporter({
    apiKey: options.apiKey,
    endpoint: options.endpoint,
  });
  const processors: SpanProcessor[] = [];

  if (options.spanProcessors?.length) {
    options.spanProcessors.forEach((sp) => {
      processors.push(sp);
      log.debug("User SpanProcessor added to SDK");
    });
    log.debug(
      `Added ${options.spanProcessors.length} user SpanProcessors to SDK`,
    );
  } else {
    processors.push(new BatchSpanProcessor(exporter));
    log.debug("Added BatchSpanProcessor to SDK");
  }

  const sdk = new NodeSDK({
    resource,
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
  log.debug("NodeSDK started successfully");

  return sdk;
}

export function getLangWatchTracerInstance(): ReturnType<typeof getLangWatchTracer> {
  if (!_langwatchTracer) {
    _langwatchTracer = getLangWatchTracer(LANGWATCH_TRACER_NAME, LANGWATCH_SDK_VERSION);
  }
  return _langwatchTracer;
}
