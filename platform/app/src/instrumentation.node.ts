// Platform self-reference guard — the FIRST import so it runs before any OTel or
// langwatch module is evaluated (or any import-time side effect can wire an exporter).
// A platform process holding LANGWATCH_API_KEY would self-reference its own trace
// ingest; the boot module throws. See langwatchPlatformGuard for the full rationale.
// biome-ignore-all lint/suspicious/noEmptyBlockStatements: the empty blocks in this file are deliberate no-ops.

import "./langwatchPlatformGuard.boot";

import { metrics } from "@opentelemetry/api";

import {
  isRedisCommandTracingEnabled,
  redisInstrumentationConfig,
} from "./instrumentation.redis";
// Dependency-free by design — safe on the boot path, before the app graph.
import { startProfiling } from "./server/profiling/startProfiling";
import { registerTelemetryFlush } from "./server/shutdown/telemetry";

const isEnvTrue = (value: string | undefined) => value === "true";

// A trailing slash on the endpoint would produce `//v1/traces`, which some
// collectors 404 on.
const explicitEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(
  /\/+$/,
  "",
);
const langwatchTracingEnabled = !!process.env.LANGWATCH_API_KEY;

const redisCommandTracingEnabled = isRedisCommandTracingEnabled();

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
  const {
    CompositePropagator,
    W3CBaggagePropagator,
    W3CTraceContextPropagator,
  } = require("@opentelemetry/core") as typeof import("@opentelemetry/core");
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
  const { OpenAIInstrumentation } =
    require("@opentelemetry/instrumentation-openai") as typeof import("@opentelemetry/instrumentation-openai");
  const { PinoInstrumentation } =
    require("@opentelemetry/instrumentation-pino") as typeof import("@opentelemetry/instrumentation-pino");
  const { RuntimeNodeInstrumentation } =
    require("@opentelemetry/instrumentation-runtime-node") as typeof import("@opentelemetry/instrumentation-runtime-node");

  const redisInstrumentation = () => {
    const { IORedisInstrumentation } =
      require("@opentelemetry/instrumentation-ioredis") as typeof import("@opentelemetry/instrumentation-ioredis");

    return new IORedisInstrumentation(redisInstrumentationConfig);
  };

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

  const observability = setupObservability({
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
    advanced: {
      // The SDK otherwise registers its own SIGTERM/SIGINT handlers that call
      // process.exit(0) as soon as its OTel flush resolves — a second or two
      // into a shutdown, killing a queue drain that is entitled to 25s. Node
      // runs every listener for a signal, so this is not a race we could win
      // by ordering: whoever calls exit() first ends the process. Its flush is
      // registered as a shutdown phase below instead, so telemetry is still
      // exported but never decides when the process dies.
      disableAutoShutdown: true,
    },
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
    // ioredis is opt-in; see redisCommandTracingEnabled for the volume it
    // produces when a job queue shares the process.
    instrumentations: [
      new AwsInstrumentation(),
      new OpenAIInstrumentation(),
      new PinoInstrumentation(),
      new RuntimeNodeInstrumentation(),
      ...(redisCommandTracingEnabled ? [redisInstrumentation()] : []),
    ],
  });

  // Which spans are being kept. The SDK reads OTEL_TRACES_SAMPLER and
  // OTEL_TRACES_SAMPLER_ARG itself and falls back to parentbased_always_on, so
  // nothing here parses them — but an unset variable and a misspelled one
  // produce the same silence and the same full-rate export, and the cost of
  // that lands on the collector rather than anywhere obvious. One line at boot
  // is the answer to "is this fleet sampling or not?" without reading a chart.
  console.log(
    `[observability] trace sampling: ${
      process.env.OTEL_TRACES_SAMPLER ?? "parentbased_always_on (default)"
    }${
      process.env.OTEL_TRACES_SAMPLER_ARG
        ? ` at ${process.env.OTEL_TRACES_SAMPLER_ARG}`
        : ""
    }`,
  );

  // Replaces the exit-on-flush the SDK does by default (disabled above): the
  // same flush, run as the last phase of the one graceful-shutdown sequence,
  // with no opinion about when the process should end.
  registerTelemetryFlush({
    name: "observability-sdk",
    run: async () => {
      await observability.shutdown();
    },
  });
} else {
  // Silence here is ambiguous: "deliberately off" and "the deploy forgot the
  // variable" look identical, and the second is only ever discovered by going
  // looking for traces that were never sent. One line at boot separates them.
  // Naming the two variables is the point — it is the answer to "why do I see
  // no traces?" without a trip to the docs.
  console.log(
    "[observability] disabled — neither OTEL_EXPORTER_OTLP_ENDPOINT nor LANGWATCH_API_KEY is set; no traces or logs will be exported",
  );
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

  // Registered as a shutdown phase rather than a signal handler of its own.
  // Node runs every listener for a signal, so handling SIGTERM here raced the
  // graceful-shutdown path instead of participating in it, and the last
  // periodic export was dropped whenever the exit won. Now the runner flushes
  // this after the work has drained. See server/shutdown/telemetry.ts.
  registerTelemetryFlush({
    name: "metrics",
    run: async () => {
      await meterProvider.forceFlush();
    },
  });
}

// Continuous profiling. Gated on its own endpoint rather than on the OTLP one:
// profiles go to Pyroscope over Pyroscope's own protocol, not through the
// collector, so the two can be configured — and fail — independently. In local
// development haven writes PYROSCOPE_SERVER_ADDRESS into .env.portless whenever
// the shared observability stack is up; in production it names the in-cluster
// Pyroscope service.
//
// The identity is read from the OTel variables on purpose. A flame graph that
// cannot be lined up with the trace beside it is a curiosity, and a second set
// of name/environment variables would drift the first time someone renamed one.
//
// NODE_ENV is the fallback rather than the source. ENVIRONMENT is what every
// other service in the repo reads for "which install is this", and it is what
// our own deployment sets — but the Helm chart only emits NODE_ENV, so without
// this a chart install would push profiles with no environment label at all and
// nothing would fail. NODE_ENV answers a coarser question (which runtime mode,
// so "production" in most staging installs), which is a worse label than
// ENVIRONMENT and a much better one than none.
//
// Deliberately not fixed by teaching the chart to emit ENVIRONMENT: that
// variable also feeds @langwatch/ksuid, which prefixes every generated ID with
// it unless it reads exactly "prod". Injecting it chart-wide would silently
// move every self-hosted install's new IDs from `local_…` to `production_…` on
// upgrade, which is a far larger change than labelling a flame graph.
const profiler = startProfiling({
  serverAddress: process.env.PYROSCOPE_SERVER_ADDRESS,
  appName: process.env.OTEL_SERVICE_NAME ?? "langwatch-app",
  environment: process.env.ENVIRONMENT ?? process.env.NODE_ENV,
  resourceAttributes: process.env.OTEL_RESOURCE_ATTRIBUTES,
});
if (profiler) {
  registerTelemetryFlush({
    name: "profiling",
    run: async () => {
      await profiler.stop();
    },
  });
}
