import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { getApiKey, getEndpoint, setConfig, SetupOptions } from "./client";
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

let sdk: NodeSDK | null = null;

export async function setup(options: SetupOptions) {
  if (sdk) {
    await sdk.shutdown();
  }

  setConfig(options);

  if (options.disableOpenTelemetryAutomaticSetup) return;

  const endpointURL = new URL("/api/otel/v1/traces", getEndpoint());

  sdk = new NodeSDK({
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({
        headers: {
          "Authorization": `Bearer ${getApiKey()}`
        },
        url: endpointURL.toString(),
      })),
    ]
  });

  sdk.start();
}
