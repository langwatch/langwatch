import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
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
  });

  const provider = new WebTracerProvider({
    resource,
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  return provider;
}

