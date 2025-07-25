import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { getApiKey, getEndpoint, setConfig, SetupOptions } from "./client";
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from "@opentelemetry/resources";
import { version } from "../package.json";
import * as intSemconv from "./observability/semconv";

let sdk: NodeSDK | null = null;
let exitHandlerRegistered = false;
const exitSignals = ["SIGINT", "SIGTERM", "beforeExit"];
let cleanupHandlers: (() => void)[] = [];

export async function setup(options: SetupOptions = {}) {
  if (sdk) {
    await sdk.shutdown();
    // Remove previous exit handlers
    cleanupHandlers.forEach((cleanup) => cleanup());
    cleanupHandlers = [];
    exitHandlerRegistered = false;
  }

  setConfig(options);

  if (options.disableOpenTelemetryAutomaticSetup) return;

  const endpointURL = new URL("/api/otel/v1/traces", getEndpoint());

  const processor = new BatchSpanProcessor(new OTLPTraceExporter({
    headers: {
      "Authorization": `Bearer ${getApiKey()}`
    },
    url: endpointURL.toString(),
  }));

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [intSemconv.ATTR_LANGWATCH_SDK_LANGUAGE]: "typescript-node",
      [intSemconv.ATTR_LANGWATCH_SDK_VERSION]: version,
      [intSemconv.ATTR_LANGWATCH_SDK_NAME]: "langwatch-observability-sdk",
    }),
    spanProcessors: [processor],
  });

  sdk.start();

  // Register exit handlers to flush spans before process ends
  if (!exitHandlerRegistered) {
    exitSignals.forEach((signal) => {
      const handler = async () => {
        if (sdk) {
          try {
            await sdk.shutdown();
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error("Error shutting down OpenTelemetry SDK:", e);
          }
        }
        if (signal !== "beforeExit") {
          process.exit();
        }
      };
      process.on(signal as any, handler);
      cleanupHandlers.push(() => process.off(signal as any, handler));
    });
    exitHandlerRegistered = true;
  }
}
