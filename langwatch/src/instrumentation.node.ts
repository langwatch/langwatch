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
      ...getNodeAutoInstrumentations({
        // disable everything noisy by default
        "@opentelemetry/instrumentation-aws-lambda": { enabled: false },
        "@opentelemetry/instrumentation-undici": { enabled: false },
        "@opentelemetry/instrumentation-http": { enabled: false },
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
        "@opentelemetry/instrumentation-dns": { enabled: false },
        "@opentelemetry/instrumentation-net": { enabled: false },
        "@opentelemetry/instrumentation-socket.io": { enabled: false },
        "@opentelemetry/instrumentation-generic-pool": { enabled: false },
        "@opentelemetry/instrumentation-bunyan": { enabled: false },
        "@opentelemetry/instrumentation-winston": { enabled: false },
        "@opentelemetry/instrumentation-graphql": { enabled: false },
        "@opentelemetry/instrumentation-dataloader": { enabled: false },
        "@opentelemetry/instrumentation-amqplib": { enabled: false },
        "@opentelemetry/instrumentation-kafkajs": { enabled: false },
        "@opentelemetry/instrumentation-lru-memoizer": { enabled: false },
        "@opentelemetry/instrumentation-cucumber": { enabled: false },
        "@opentelemetry/instrumentation-router": { enabled: false },

        // Truncate ioredis db.statement to command + first key
        // (avoud logging content + large attribtes)
        "@opentelemetry/instrumentation-ioredis": {
          dbStatementSerializer: (
            cmdName: string,
            cmdArgs: Array<string | Buffer | number | unknown[]>,
          ) => {
            const key = typeof cmdArgs[0] === "string" ? cmdArgs[0] : "";
            return key ? `${cmdName} ${key}` : cmdName;
          },
        },
      }),
    ],
  });
}
