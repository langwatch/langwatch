import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { attributes } from "langwatch/observability";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

export function createFoundryProvider({
  apiKey,
  endpoint,
  resourceAttributes,
}: {
  apiKey: string;
  endpoint: string;
  resourceAttributes: Record<string, string>;
}) {
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: resourceAttributes["service.name"] ?? "foundry",
    [attributes.ATTR_LANGWATCH_SDK_LANGUAGE]: "typescript",
    [attributes.ATTR_LANGWATCH_SDK_NAME]: "langwatch-foundry-sdk",
    [attributes.ATTR_LANGWATCH_SDK_VERSION]: "0.0.1",
    ...(resourceAttributes["service.version"]
      ? { [ATTR_SERVICE_VERSION]: resourceAttributes["service.version"] }
      : {}),
  });

  const url = new URL("/api/otel/v1/traces", endpoint).toString();

  const exporter = new OTLPTraceExporter({
    url,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "x-langwatch-sdk-name": "langwatch-foundry",
      "x-langwatch-sdk-language": "typescript",
      "x-langwatch-sdk-runtime": "web",
    },
    // Allow many concurrent batch exports — large foundry traces can produce
    // thousands of spans, and the default (10) silently drops anything queued
    // beyond that.
    concurrencyLimit: 64,
  });

  const provider = new WebTracerProvider({
    resource,
    // Batch spans into bigger OTLP payloads instead of one HTTP request per
    // `span.end()`. The foundry can generate thousands of spans synchronously,
    // so SimpleSpanProcessor would otherwise blow past the browser's per-origin
    // connection limit and the exporter's concurrency limit, silently losing
    // most of them.
    spanProcessors: [
      new BatchSpanProcessor(exporter, {
        maxExportBatchSize: 256,
        maxQueueSize: 8192,
        scheduledDelayMillis: 50,
        exportTimeoutMillis: 30_000,
      }),
    ],
  });

  return provider;
}

