import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { setConfig, SetupOptions, getApiKey, getEndpoint } from "./client";
import { BatchSpanProcessor, WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { B3Propagator } from '@opentelemetry/propagator-b3';

let provider: WebTracerProvider | null = null;

export async function setup(options: SetupOptions) {
  if (provider) {
    await provider.shutdown();
  }

  setConfig(options);

  if (options.disableOpenTelemetryAutomaticSetup) return;

  const endpointURL = new URL("/api/otel/v1/traces", getEndpoint());

  provider = new WebTracerProvider({
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({
      headers: {
        "Authorization": `Bearer ${getApiKey()}`
      },
      url: endpointURL.toString(),
    }))],
  });

  provider.register({
    contextManager: new ZoneContextManager(),
    propagator: new B3Propagator(),
  });
}
