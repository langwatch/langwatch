import { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { getApiKey, getEndpoint, setConfig, SetupOptions } from "./client";
import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from "@opentelemetry/resources";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { version } from "../package.json";
import * as intSemconv from "./observability/semconv";
import { addSpanProcessorToExistingTracerProvider, isOtelInitialized, mergeResourceIntoExistingTracerProvider } from "./client-shared";
import { FilterableBatchSpanProcessor } from "./observability";
import { LangWatchExporter } from "./observability/exporters";

let managedSpanProcessors: SpanProcessor[] = [];
let nodeSetupCalled: boolean = false;
let sdk: NodeSDK | null = null;

export async function setup(options: SetupOptions = {}) {
  if (nodeSetupCalled) {
    throw new Error("LangWatch setup has already been called in this process. Setup can only be called once, if you need to modify OpenTelemetry setup then use the OpenTelemetry API directly.");
  }

  setConfig(options);
  nodeSetupCalled = true;

  if (options.disableOpenTelemetryAutomaticSetup) return;

  const endpointURL = new URL("/api/otel/v1/traces", getEndpoint());
  const langwatchSpanProcessor = new FilterableBatchSpanProcessor(
    new LangWatchExporter(getApiKey(), endpointURL.toString()),
    options.otelSpanProcessingExcludeRules ?? [],
  );

  const langwatchResource = resourceFromAttributes({
    [intSemconv.ATTR_LANGWATCH_SDK_LANGUAGE]: "typescript-node",
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
    sdk = new NodeSDK({
      resource: langwatchResource,
      spanProcessors: [langwatchSpanProcessor, ...(options.otelSpanProcessors ?? [])],
      contextManager: new AsyncLocalStorageContextManager(),
      textMapPropagator: new W3CTraceContextPropagator(),
    });

    sdk.start();
  }

  // If we detect interrupt, termination, or test beforeExit signals, then we attempt
  // to shutdown.
  // - If an SDK exists, then we just attempt to shutdown the SDK.
  // - If no SDK exists, then we attempt to shutdown ONLY the SpanProcessors that are
  //   managed by this LangWatch SDK.
  ["SIGINT", "SIGTERM", "beforeExit"].forEach((signal) => {
    process.on(signal as any, async () => {
      try {
        if (sdk) {
          await sdk.shutdown();
        } else {
          await Promise.all(managedSpanProcessors.map(p => p.shutdown()));
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Error shutting down OpenTelemetry SDK:", error);
      }

      if (signal !== "beforeExit") {
        process.exit();
      }
    });
  });
}
