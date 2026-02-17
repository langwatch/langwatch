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
      "deployment.environment": process.env.ENVIRONMENT,
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
        // --- Disable everything noisy by default ---
        "@opentelemetry/instrumentation-aws-lambda": { enabled: false },
        "@opentelemetry/instrumentation-undici": { enabled: false },
        "@opentelemetry/instrumentation-http": { enabled: false },
        // Database: these generate a span per query, massive volume
        // pg, ioredis kept enabled for DB/Redis observability
        "@opentelemetry/instrumentation-mongodb": { enabled: false },
        "@opentelemetry/instrumentation-mongoose": { enabled: false },
        "@opentelemetry/instrumentation-mysql": { enabled: false },
        "@opentelemetry/instrumentation-mysql2": { enabled: false },
        "@opentelemetry/instrumentation-redis": { enabled: false },
        "@opentelemetry/instrumentation-tedious": { enabled: false },
        "@opentelemetry/instrumentation-oracledb": { enabled: false },
        "@opentelemetry/instrumentation-memcached": { enabled: false },
        "@opentelemetry/instrumentation-cassandra-driver": { enabled: false },
        "@opentelemetry/instrumentation-knex": { enabled: false },
        // Network-level: extremely verbose
        "@opentelemetry/instrumentation-dns": { enabled: false },
        "@opentelemetry/instrumentation-net": { enabled: false },
        "@opentelemetry/instrumentation-socket.io": { enabled: false },
        "@opentelemetry/instrumentation-generic-pool": { enabled: false },
        // pino kept enabled for log correlation
        "@opentelemetry/instrumentation-bunyan": { enabled: false },
        "@opentelemetry/instrumentation-winston": { enabled: false },
        // GraphQL: a span per resolver adds up fast
        "@opentelemetry/instrumentation-graphql": { enabled: false },
        "@opentelemetry/instrumentation-dataloader": { enabled: false },
        // Message queues
        "@opentelemetry/instrumentation-amqplib": { enabled: false },
        "@opentelemetry/instrumentation-kafkajs": { enabled: false },
        // Misc
        "@opentelemetry/instrumentation-lru-memoizer": { enabled: false },
        "@opentelemetry/instrumentation-cucumber": { enabled: false },
        "@opentelemetry/instrumentation-router": { enabled: false },
      }),
    ],
  });
}