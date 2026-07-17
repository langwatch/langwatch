// Platform self-reference guard — the FIRST import so it runs before any OTel or
// langwatch module is evaluated (or any import-time side effect can wire an exporter).
// A platform process holding LANGWATCH_API_KEY would self-reference its own trace
// ingest; the boot module throws. See langwatchPlatformGuard for the full rationale.
import "./langwatchPlatformGuard.boot";

import { metrics } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { HostMetrics } from "@opentelemetry/host-metrics";
import { awsEksDetector } from "@opentelemetry/resource-detector-aws";
import {
  detectResources,
  envDetector,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { setupObservability } from "langwatch/observability/node";

const isEnvTrue = (value: string | undefined) => value === "true";

// A trailing slash on the endpoint would produce `//v1/traces`, which some
// collectors 404 on.
const explicitEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(
  /\/+$/,
  "",
);
const langwatchTracingEnabled = !!process.env.LANGWATCH_API_KEY;

const spanProcessors = [] as Array<BatchSpanProcessor>;
const logRecordProcessors = [] as Array<BatchLogRecordProcessor>;

if (explicitEndpoint) {
  // OTLPExporters automatically reads OTEL_EXPORTER_OTLP_HEADERS from environment
  // Format: "key1=value1,key2=value2" (e.g., "Authorization=Bearer token")

  spanProcessors.push(
    new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: `${explicitEndpoint}/v1/traces`,
      }),
    ),
  );

  if (isEnvTrue(process.env.PINO_OTEL_ENABLED)) {
    logRecordProcessors.push(
      new BatchLogRecordProcessor(
        new OTLPLogExporter({
          url: `${explicitEndpoint}/v1/logs`,
        }),
      ),
    );
  }
}

if (
  spanProcessors.length > 0 ||
  logRecordProcessors.length > 0 ||
  langwatchTracingEnabled
) {
  setupObservability({
    langwatch: langwatchTracingEnabled ? undefined : "disabled",
    attributes: {
      "service.name": "langwatch-backend",
      "deployment.environment": process.env.ENVIRONMENT,
    },
    // envDetector merges OTEL_RESOURCE_ATTRIBUTES (e.g. langwatch.worktree=<name>,
    // set by `make observability-connect`) so telemetry from each worktree is
    // filterable in Grafana.
    resource: detectResources({
      detectors: [awsEksDetector, envDetector],
    }),
    advanced: {},
    // Cap per-span payload growth. OTel's defaults are unbounded
    // (`attributeValueLengthLimit: Infinity`, `attributeCountLimit: 128` only
    // in newer SDKs) — a single span carrying an oversized `db.statement` or a
    // huge attribute bag can bloat a trace and, in bulk, pressure the
    // collector's WAL. These caps bound each span's attribute footprint:
    // values are truncated at 12k chars and no more than 128 attributes are
    // kept per span. This is defense-in-depth alongside the per-job root-trace
    // scoping and ioredis `requireParentSpan` scoping.
    spanLimits: {
      attributeValueLengthLimit: 12_000,
      attributeCountLimit: 128,
    },
    spanProcessors: spanProcessors,
    logRecordProcessors: logRecordProcessors,
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

        // ioredis auto-instrumentation emits one span PER Redis command. The
        // event-sourcing GroupQueue worker runs continuous background loops on
        // Redis — BRPOP signal polling, Lua-script leasing (evalsha), holder-set
        // bookkeeping (sadd/srem), active-key heartbeats (expire), and stats
        // pushes (lpush) — none of which sit under any application span. Left
        // unscoped, those loops produced an unbounded per-command span flood
        // that (together with the mega-trace bug fixed in the GroupQueue) OOM
        // crash-looped the self-observability Tempo.
        //
        // `requireParentSpan: true` scopes ioredis so a command is only traced
        // when it already runs inside an application span (an HTTP request, a
        // per-job CONSUMER span, etc.). The queue's own plumbing loops — which
        // have no active parent span — stop creating spans entirely, while
        // Redis calls made inside real request/job work are still captured
        // (and remain bounded now that each job is its own root trace).
        "@opentelemetry/instrumentation-ioredis": {
          requireParentSpan: true,
          // Truncate ioredis db.statement to command + first key
          // (avoid logging content + large attributes)
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

// Metrics are a separate global MeterProvider (setupObservability only wires
// traces + logs). Gated on OTEL_METRICS_ENABLED so it stays off by default and
// only pushes to a collector that's actually configured. Emits Node/host
// runtime metrics (CPU, memory, event loop, GC) — enough to correlate with the
// traces + logs when debugging local dev in Grafana.
if (explicitEndpoint && isEnvTrue(process.env.OTEL_METRICS_ENABLED)) {
  const metricAttrs: Record<string, string> = {
    "service.name": process.env.OTEL_SERVICE_NAME ?? "langwatch-backend",
  };
  if (process.env.ENVIRONMENT) {
    metricAttrs["deployment.environment"] = process.env.ENVIRONMENT;
  }

  const meterProvider = new MeterProvider({
    // Merge OTEL_RESOURCE_ATTRIBUTES (e.g. langwatch.worktree) into the metric
    // resource too, so metrics carry the same worktree label as traces/logs.
    resource: resourceFromAttributes(metricAttrs).merge(
      detectResources({ detectors: [envDetector] }),
    ),
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: `${explicitEndpoint}/v1/metrics`,
        }),
        exportIntervalMillis: 15_000,
      }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);

  new HostMetrics({ meterProvider, name: "langwatch-backend" }).start();

  // The graceful-shutdown path (start.ts / workers.ts) calls process.exit(0)
  // without waiting on this provider, so the last periodic export can be
  // dropped. Race a best-effort flush against that exit.
  const flushMetricsOnExit = () => void meterProvider.forceFlush().catch(() => {});
  process.on("SIGTERM", flushMetricsOnExit);
  process.on("SIGINT", flushMetricsOnExit);
}
