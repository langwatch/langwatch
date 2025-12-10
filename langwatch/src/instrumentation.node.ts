import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { awsEksDetector } from "@opentelemetry/resource-detector-aws";
import { detectResources } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { setupObservability } from "langwatch/observability/node";

const explicitEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const isProd = process.env.NODE_ENV === "production";

const spanProcessors = [] as Array<BatchSpanProcessor | SimpleSpanProcessor>;

if (explicitEndpoint) {
  // OTLPTraceExporter automatically reads OTEL_EXPORTER_OTLP_HEADERS from environment
  // Format: "key1=value1,key2=value2" (e.g., "Authorization=Bearer token")
  const exporter = new OTLPTraceExporter({
    url: `${explicitEndpoint}/v1/traces`,
  });

  if (isProd) {
    spanProcessors.push(new BatchSpanProcessor(exporter));
  } else {
    spanProcessors.push(new SimpleSpanProcessor(exporter));
  }
}

if (spanProcessors.length > 0) {
  setupObservability({
    langwatch: "disabled",
    attributes: {
      "service.name": "langwatch-backend",
      "deployment.environment": process.env.NODE_ENV,
    },
    resource: detectResources({
      detectors: [awsEksDetector],
    }),
    spanProcessors: spanProcessors,
    textMapPropagator: new CompositePropagator({
      propagators: [
        new W3CTraceContextPropagator(),
        new W3CBaggagePropagator(),
      ],
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-aws-sdk": {
          enabled: false,
        },
        // Disable this until we kill Elastic Search
        "@opentelemetry/instrumentation-undici": {
          enabled: false,
        },
        "@opentelemetry/instrumentation-http": {
          enabled: false,
        },
      }),
    ],
  });
}
