import { setConfig, SetupOptions, getApiKey, getEndpoint } from "./client";
import { SpanProcessor, WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { version } from "../package.json";
import { resourceFromAttributes } from "@opentelemetry/resources";
import * as intSemconv from "./observability/semconv";
import { FilterableBatchSpanProcessor } from "./observability/processors";
import { LangWatchExporter } from "./observability/exporters";
import { addSpanProcessorToExistingTracerProvider, isOtelInitialized, mergeResourceIntoExistingTracerProvider } from "./client-shared";

let managedSpanProcessors: SpanProcessor[] = [];
let provider: WebTracerProvider | null = null;
let browserSetupCalled: boolean = false;

export async function setupLangWatch(options: SetupOptions = {}) {
  if (browserSetupCalled) {
    throw new Error("LangWatch setup has already been called in this process. Setup can only be called once, if you need to modify OpenTelemetry setup then use the OpenTelemetry API directly.");
  }

  setConfig(options);

  if (options.skipOpenTelemetrySetup) return;

  const endpointURL = new URL("/api/otel/v1/traces", getEndpoint());
  const langwatchSpanProcessor = new FilterableBatchSpanProcessor(
    new LangWatchExporter({
      apiKey: getApiKey(),
      endpoint: endpointURL.toString(),
    }),
    options.otelSpanProcessingExcludeRules ?? [],
  );

  const langwatchResource = resourceFromAttributes({
    ...options.baseAttributes,
    [intSemconv.ATTR_LANGWATCH_SDK_LANGUAGE]: "typescript-browser",
    [intSemconv.ATTR_LANGWATCH_SDK_VERSION]: version,
    [intSemconv.ATTR_LANGWATCH_SDK_NAME]: "langwatch-observability-sdk",
  });

  if (isOtelInitialized()) {
    mergeResourceIntoExistingTracerProvider(langwatchResource);
    addSpanProcessorToExistingTracerProvider(langwatchSpanProcessor);
    for (const spanProcessor of options.otelSpanProcessors ?? []) {
      addSpanProcessorToExistingTracerProvider(spanProcessor);
    }

    managedSpanProcessors = [langwatchSpanProcessor];
  } else {
    provider = new WebTracerProvider({
      resource: resourceFromAttributes({
        [intSemconv.ATTR_LANGWATCH_SDK_LANGUAGE]: "typescript-browser",
        [intSemconv.ATTR_LANGWATCH_SDK_VERSION]: version,
        [intSemconv.ATTR_LANGWATCH_SDK_NAME]: "langwatch-observability-sdk",
      }),
      spanProcessors: [langwatchSpanProcessor, ...(options.otelSpanProcessors ?? [])],
    });

    provider.register({
      contextManager: new ZoneContextManager(),
      propagator: new W3CTraceContextPropagator(),
    });
  }

  // This is not guaranteed to be called, but it's a good nice to have.
  window.addEventListener("beforeunload", async () => {
    if (provider) {
      await provider.shutdown();
    } else {
      await Promise.all(managedSpanProcessors.map(p => p.shutdown()));
    }
  });
}
