// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import * as SentryNode from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import { setupObservability } from "langwatch/observability/node";
import { BatchSpanProcessor, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter as OTLPTraceExporterProto } from "@opentelemetry/exporter-trace-otlp-proto";
import { detectResources } from "@opentelemetry/resources";
import { awsEksDetector } from "@opentelemetry/resource-detector-aws";

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const spanProcessors = [];
  if (process.env.NODE_ENV === "production") {
    spanProcessors.push(new BatchSpanProcessor(new OTLPTraceExporterProto({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT })));
  } else {
    spanProcessors.push(new SimpleSpanProcessor(new OTLPTraceExporterProto({ url: "http://0.0.0.0:4317/v1/traces" })));
    spanProcessors.push(new SimpleSpanProcessor(new OTLPTraceExporterProto({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT })));
  }

  setupObservability({
    attributes: {
      "process.runtime.env": process.env.NODE_ENV,
      "service.instance.id": process.env.INSTANCE_ID,
    },
    resource: detectResources({
      detectors: [awsEksDetector],
    }),
    spanProcessors: spanProcessors,
    instrumentations: [getNodeAutoInstrumentations()],
  });
}

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production",

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: 1.0,

  // Enable only for /api/collector for now
  tracesSampler: (samplingContext) => {
    const request = samplingContext?.normalizedRequest;

    if (request?.url) {
      if (request.url.includes("/api/collector")) {
        return 1.0; // 100% sampling
      }
      return 0.0; // Disable for all other endpoints
    }

    // Default sampling rate for non-request operations
    return 1.0;
  },

  beforeSend(event, hint) {
    if (`${hint.originalException as any}`.includes("Max runtime reached")) {
      return null;
    }
    return event;
  },

  integrations: [SentryNode.prismaIntegration(), nodeProfilingIntegration()],

  profilesSampleRate: 1.0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
});
