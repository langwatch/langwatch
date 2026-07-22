// Platform self-reference guard — the FIRST import so it runs before any OTel or
// langwatch module is evaluated (or any import-time side effect can wire an exporter).
// A platform process holding LANGWATCH_API_KEY would self-reference its own trace
// ingest; the boot module throws. See langwatchPlatformGuard for the full rationale.
import "./langwatchPlatformGuard.boot";

import { metrics } from "@opentelemetry/api";

const isEnvTrue = (value: string | undefined) => value === "true";

// A trailing slash on the endpoint would produce `//v1/traces`, which some
// collectors 404 on.
const explicitEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(
  /\/+$/,
  "",
);
const langwatchTracingEnabled = !!process.env.LANGWATCH_API_KEY;

// Load the OTel SDK + instrumentation packages ONLY when observability is
// actually configured (an OTLP endpoint or a LangWatch API key). When neither
// is set — the common local-dev / self-hosted case — none of these modules
// (SDK, exporters, resource detectors, and the instrumentation packages with
// their transitive deps) load at boot at all.
//
// Loaded via `require` (not a static `import`, not top-level `await import`):
// this module compiles to CJS — where top-level await is illegal — so a gated
// synchronous `require` is the way to make the load conditional while keeping
// the tracer registered before ./start evaluates. Same pattern as workers.ts.
if (explicitEndpoint || langwatchTracingEnabled) {
  const { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } =
    require("@opentelemetry/core") as typeof import("@opentelemetry/core");
  const { OTLPLogExporter } =
    require("@opentelemetry/exporter-logs-otlp-proto") as typeof import("@opentelemetry/exporter-logs-otlp-proto");
  const { OTLPTraceExporter } =
    require("@opentelemetry/exporter-trace-otlp-proto") as typeof import("@opentelemetry/exporter-trace-otlp-proto");
  const { awsEksDetector } =
    require("@opentelemetry/resource-detector-aws") as typeof import("@opentelemetry/resource-detector-aws");
  const { detectResources, envDetector } =
    require("@opentelemetry/resources") as typeof import("@opentelemetry/resources");
  const { BatchLogRecordProcessor } =
    require("@opentelemetry/sdk-logs") as typeof import("@opentelemetry/sdk-logs");
  const { BatchSpanProcessor } =
    require("@opentelemetry/sdk-trace-node") as typeof import("@opentelemetry/sdk-trace-node");
  const { setupObservability } =
    require("langwatch/observability/node") as typeof import("langwatch/observability/node");
  const { AwsInstrumentation } =
    require("@opentelemetry/instrumentation-aws-sdk") as typeof import("@opentelemetry/instrumentation-aws-sdk");
  const { IORedisInstrumentation } =
    require("@opentelemetry/instrumentation-ioredis") as typeof import("@opentelemetry/instrumentation-ioredis");
  const { OpenAIInstrumentation } =
    require("@opentelemetry/instrumentation-openai") as typeof import("@opentelemetry/instrumentation-openai");
  const { PinoInstrumentation } =
    require("@opentelemetry/instrumentation-pino") as typeof import("@opentelemetry/instrumentation-pino");
  const { RuntimeNodeInstrumentation } =
    require("@opentelemetry/instrumentation-runtime-node") as typeof import("@opentelemetry/instrumentation-runtime-node");

  const spanProcessors = [] as Array<InstanceType<typeof BatchSpanProcessor>>;
  const logRecordProcessors = [] as Array<
    InstanceType<typeof BatchLogRecordProcessor>
  >;

  if (explicitEndpoint) {
    // OTLPExporters automatically read OTEL_EXPORTER_OTLP_HEADERS from environment
    // Format: "key1=value1,key2=value2" (e.g., "Authorization=Bearer token")
    spanProcessors.push(
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${explicitEndpoint}/v1/traces` }),
      ),
    );

    if (isEnvTrue(process.env.PINO_OTEL_ENABLED)) {
      logRecordProcessors.push(
        new BatchLogRecordProcessor(
          new OTLPLogExporter({ url: `${explicitEndpoint}/v1/logs` }),
        ),
      );
    }
  }

  setupObservability({
    langwatch: langwatchTracingEnabled ? undefined : "disabled",
    attributes: {
      "service.name": process.env.OTEL_SERVICE_NAME ?? "langwatch-app",
      "deployment.environment.name": process.env.ENVIRONMENT,
      // Provenance marker shared with the Go services (pkg/otelsetup):
      // everything the platform emits about ITSELF is identifiable as
      // internal wherever it lands, so a misrouted payload can be
      // recognised and refused. Customer traces never carry it.
      "langwatch.origin": "platform_internal",
    },
    // envDetector merges OTEL_RESOURCE_ATTRIBUTES (e.g. langwatch.worktree=<name>,
    // set by `make observability-connect`) so telemetry from each worktree is
    // filterable in Grafana.
    resource: detectResources({
      detectors: [awsEksDetector, envDetector],
    }),
    advanced: {},
    spanProcessors: spanProcessors,
    logRecordProcessors: logRecordProcessors,
    textMapPropagator: new CompositePropagator({
      propagators: [
        new W3CTraceContextPropagator(),
        new W3CBaggagePropagator(),
      ],
    }),
    // Explicit instrumentations instead of @opentelemetry/auto-instrumentations-node:
    // the aggregate loads all ~41 instrumentation packages at import time even
    // though the old config disabled most and the rest target frameworks this
    // server doesn't run (express, koa, hapi, connect, grpc, nest, restify, pg).
    // These five are the ones that actually emit telemetry here; the emitted
    // spans/metrics are unchanged. Add a new library worth tracing by adding its
    // instrumentation package to the Promise.all above and a `new …()` here.
    instrumentations: [
      new AwsInstrumentation(),
      new OpenAIInstrumentation(),
      new PinoInstrumentation(),
      new RuntimeNodeInstrumentation(),
      // Truncate ioredis db.statement to command + first key
      // (avoid logging content + large attributes)
      new IORedisInstrumentation({
        // Redis calls are only interesting as part of some larger operation.
        // Without this, the connection pool's `connect`/`auth`/`info` and the
        // queue dispatcher's blocking `brpop`/`xread` — none of which have a
        // parent — each became a root span, burying real traces in noise.
        requireParentSpan: true,
        dbStatementSerializer: (
          cmdName: string,
          cmdArgs: Array<string | Buffer | number | unknown[]>,
        ) => {
          const key = typeof cmdArgs[0] === "string" ? cmdArgs[0] : "";
          return key ? `${cmdName} ${key}` : cmdName;
        },
      }),
    ],
  });
}

// Metrics are a separate global MeterProvider (setupObservability only wires
// traces + logs). Gated on OTEL_METRICS_ENABLED so it stays off by default and
// only pushes to a collector that's actually configured. Emits Node/host
// runtime metrics (CPU, memory, event loop, GC) — enough to correlate with the
// traces + logs when debugging local dev in Grafana. Same gated-dynamic-import
// treatment: the metrics SDK + host-metrics only load when this path is live.
if (explicitEndpoint && isEnvTrue(process.env.OTEL_METRICS_ENABLED)) {
  const { OTLPMetricExporter } =
    require("@opentelemetry/exporter-metrics-otlp-proto") as typeof import("@opentelemetry/exporter-metrics-otlp-proto");
  const { HostMetrics } =
    require("@opentelemetry/host-metrics") as typeof import("@opentelemetry/host-metrics");
  const { detectResources, envDetector, resourceFromAttributes } =
    require("@opentelemetry/resources") as typeof import("@opentelemetry/resources");
  const { MeterProvider, PeriodicExportingMetricReader } =
    require("@opentelemetry/sdk-metrics") as typeof import("@opentelemetry/sdk-metrics");

  const metricAttrs: Record<string, string> = {
    "service.name": process.env.OTEL_SERVICE_NAME ?? "langwatch-app",
  };
  if (process.env.ENVIRONMENT) {
    metricAttrs["deployment.environment.name"] = process.env.ENVIRONMENT;
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

  new HostMetrics({
    meterProvider,
    name: process.env.OTEL_SERVICE_NAME ?? "langwatch-app",
  }).start();

  // The graceful-shutdown path (start.ts / workers.ts) calls process.exit(0)
  // without waiting on this provider, so the last periodic export can be
  // dropped. Race a best-effort flush against that exit.
  const flushMetricsOnExit = () => void meterProvider.forceFlush().catch(() => {});
  process.on("SIGTERM", flushMetricsOnExit);
  process.on("SIGINT", flushMetricsOnExit);
}
