import { setupObservability } from "langwatch/observability/node";
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter as OTLPTraceExporterProto } from "@opentelemetry/exporter-trace-otlp-proto";
import { detectResources } from "@opentelemetry/resources";
import { awsEksDetector } from "@opentelemetry/resource-detector-aws";
import {
  CompositePropagator,
  W3CTraceContextPropagator,
  W3CBaggagePropagator,
} from "@opentelemetry/core";
const explicitEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const isProd = process.env.NODE_ENV === "production";

const spanProcessors = [] as Array<BatchSpanProcessor | SimpleSpanProcessor>;

if (explicitEndpoint) {
  if (isProd) {
    spanProcessors.push(
      new BatchSpanProcessor(
        new OTLPTraceExporterProto({ url: `${explicitEndpoint}/v1/traces` }),
      ),
    );
  } else {
    spanProcessors.push(
      new SimpleSpanProcessor(
        new OTLPTraceExporterProto({ url: `${explicitEndpoint}/v1/traces` }),
      ),
    );
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
        // Disbale this until we kill Elastic Search
        "@opentelemetry/instrumentation-undici": {
          enabled: false,
        },
      }),
    ],
  });
}
