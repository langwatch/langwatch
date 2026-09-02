// Platform self-reference guard — the FIRST import so it runs before any OTel or
// langwatch module is evaluated (or any import-time side effect can wire an exporter).
// A platform process holding LANGWATCH_API_KEY would self-reference its own trace
// ingest; the boot module throws. See langwatchPlatformGuard for the full rationale.
// biome-ignore-all lint/suspicious/noEmptyBlockStatements: the empty blocks in this file are deliberate no-ops.

import "./langwatchPlatformGuard.boot";

import type { TelemetryConfig } from "@langwatch/config";
import type { ExportResult } from "@opentelemetry/core";
import type { Sampler } from "@opentelemetry/sdk-trace-base";

import { redisInstrumentationConfig } from "./instrumentation.redis";
import { assertPlatformHasNoLangwatchApiKey } from "./langwatchPlatformGuard";
// Dependency-free by design — safe on the boot path, before the app graph.
import { startProfiling } from "./server/profiling/startProfiling";
import { registerTelemetryFlush } from "./server/shutdown/telemetry";

let instrumentationInitialized = false;

type GenericOtlpExporter = {
  export<T>(items: T[], resultCallback: (result: ExportResult) => void): void;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
};

type OtlpDefaults = {
  timeoutMillis: number;
  concurrencyLimit: number;
  compression: "gzip" | "none";
};

type OtlpBaseModule = {
  OTLPExporterBase: new (delegate: unknown) => GenericOtlpExporter;
  getSharedConfigurationDefaults: () => OtlpDefaults;
};

type OtlpNodeHttpModule = {
  createOtlpHttpExportDelegate: (...args: unknown[]) => unknown;
  httpAgentFactoryFromOptions: (options: { keepAlive: boolean }) => (protocol: string) => unknown;
};

type OtlpTransformerModule = {
  LogsExporterMetricsHelper: unknown;
  MetricsExporterMetricsHelper: unknown;
  ProtobufLogsSerializer: unknown;
  ProtobufMetricsSerializer: unknown;
  ProtobufTraceSerializer: unknown;
  TraceExporterMetricsHelper: unknown;
};

export function initializeInstrumentation(config: TelemetryConfig): void {
  // The side-effect boot guard protects the ambient process boundary. Check
  // the projected value as well so callers cannot bypass it by supplying a
  // different source object to the config resolver.
  assertPlatformHasNoLangwatchApiKey({ LANGWATCH_API_KEY: config.langwatchApiKey });
  if (instrumentationInitialized) return;

  const explicitEndpoint = config.otlpEndpoint;
  const langwatchTracingEnabled = Boolean(config.langwatchApiKey);
  const redisCommandTracingEnabled = config.redisCommandTracingEnabled;

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
    const { OTLPExporterBase, getSharedConfigurationDefaults } =
      require("@opentelemetry/otlp-exporter-base") as OtlpBaseModule;
    const { createOtlpHttpExportDelegate, httpAgentFactoryFromOptions } =
      require("@opentelemetry/otlp-exporter-base/node-http") as OtlpNodeHttpModule;
    const {
      LogsExporterMetricsHelper,
      ProtobufLogsSerializer,
      ProtobufTraceSerializer,
      TraceExporterMetricsHelper,
    } = require("@opentelemetry/otlp-transformer-telemetry") as OtlpTransformerModule;
    const { awsEksDetector } =
      require("@opentelemetry/resource-detector-aws") as typeof import("@opentelemetry/resource-detector-aws");
    const { resourceFromAttributes, processDetector, hostDetector } =
      require("@opentelemetry/resources") as typeof import("@opentelemetry/resources");
    const { BatchLogRecordProcessor } =
      require("@opentelemetry/sdk-logs") as typeof import("@opentelemetry/sdk-logs");
    const { BatchSpanProcessor } =
      require("@opentelemetry/sdk-trace-node") as typeof import("@opentelemetry/sdk-trace-node");
    const { AlwaysOffSampler, AlwaysOnSampler, ParentBasedSampler, TraceIdRatioBasedSampler } =
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
    const logRecordProcessors = [] as Array<InstanceType<typeof BatchLogRecordProcessor>>;

    if (explicitEndpoint) {
      // The public OTLP exporter constructors merge ambient OTEL_*_HEADERS into
      // explicit headers. Build their delegate from the projected config
      // instead: this keeps the exporter defaults while making the process
      // projection authoritative without mutating global process.env.
      spanProcessors.push(
        new BatchSpanProcessor(
          new OTLPExporterBase(
            createOtlpHttpExportDelegate(
              createAuthoritativeOtlpConfiguration(
                `${explicitEndpoint}/v1/traces`,
                {
                  ...config.otlpHeaders,
                  ...config.otlpTracesHeaders,
                },
                "application/x-protobuf",
                getSharedConfigurationDefaults,
                httpAgentFactoryFromOptions,
              ),
              ProtobufTraceSerializer,
              "otlp_http_span_exporter",
              TraceExporterMetricsHelper,
              void 0,
            ),
          ),
        ),
      );

      if (config.pinoOtelEnabled) {
        logRecordProcessors.push(
          new BatchLogRecordProcessor({
            exporter: new OTLPExporterBase(
              createOtlpHttpExportDelegate(
                createAuthoritativeOtlpConfiguration(
                  `${explicitEndpoint}/v1/logs`,
                  {
                    ...config.otlpHeaders,
                    ...config.otlpLogsHeaders,
                  },
                  "application/x-protobuf",
                  getSharedConfigurationDefaults,
                  httpAgentFactoryFromOptions,
                ),
                ProtobufLogsSerializer,
                "otlp_http_log_exporter",
                LogsExporterMetricsHelper,
                void 0,
              ),
            ),
          }),
        );
      }
    }

    const observability = setupObservability({
      // Platform telemetry uses the explicit OTLP exporters above. Keeping
      // the SDK integration disabled also prevents it from falling back to
      // LANGWATCH_API_KEY/LANGWATCH_ENDPOINT from the ambient environment.
      langwatch: "disabled",
      attributes: {
        "service.name": config.serviceName ?? "langwatch-app",
        "deployment.environment.name": config.deploymentEnvironment,
        // Provenance marker shared with the Go services (pkg/otelsetup):
        // everything the platform emits about ITSELF is identifiable as
        // internal wherever it lands, so a misrouted payload can be
        // recognised and refused. Customer traces never carry it.
        "langwatch.origin": "platform_internal",
      },
      resource: resourceFromAttributes({
        ...config.resourceAttributesMap,
        "service.name": config.serviceName ?? "langwatch-app",
        "deployment.environment.name": config.deploymentEnvironment,
        "langwatch.origin": "platform_internal",
      }),
      // Keep infrastructure identity while excluding ambient OTel env
      // detectors; resource attributes and service identity are projected
      // above and therefore cannot diverge from the selected source.
      resourceDetectors: [awsEksDetector, processDetector, hostDetector],
      autoDetectResources: true,
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
      sampler: createSampler(
        config.tracesSampler,
        config.tracesSamplerArg,
        AlwaysOffSampler,
        AlwaysOnSampler,
        ParentBasedSampler,
        TraceIdRatioBasedSampler,
      ),
      textMapPropagator: new CompositePropagator({
        propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
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

    // Which spans are being kept. The sampler is constructed from the
    // projected values above, so the SDK cannot diverge by reading ambient
    // OTEL_TRACES_SAMPLER or OTEL_TRACES_SAMPLER_ARG. One line at boot is the
    // answer to "is this fleet sampling or not?" without reading a chart.
    console.log(
      `[observability] trace sampling: ${
        config.tracesSampler ?? "parentbased_always_on (default)"
      }${config.tracesSamplerArg ? ` at ${config.tracesSamplerArg}` : ""}`,
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
    serverAddress: config.pyroscopeServerAddress,
    appName: config.serviceName ?? "langwatch-app",
    environment: config.deploymentEnvironment ?? config.nodeEnvironment,
    resourceAttributes: config.resourceAttributes,
  });
  if (profiler) {
    registerTelemetryFlush({
      name: "profiling",
      run: async () => {
        await profiler.stop();
      },
    });
  }

  instrumentationInitialized = true;
}

function createSampler(
  samplerName: string | undefined,
  samplerArgument: string | undefined,
  AlwaysOffSampler: new () => Sampler,
  AlwaysOnSampler: new () => Sampler,
  ParentBasedSampler: new (config: { root: Sampler }) => Sampler,
  TraceIdRatioBasedSampler: new (ratio: number) => Sampler,
): Sampler {
  const ratio = parseSamplerRatio(samplerArgument);
  const root = new AlwaysOnSampler();

  switch (samplerName) {
    case "always_off":
      return new AlwaysOffSampler();
    case "always_on":
      return root;
    case "traceidratio":
      return new TraceIdRatioBasedSampler(ratio);
    case "parentbased_always_off":
      return new ParentBasedSampler({ root: new AlwaysOffSampler() });
    case "parentbased_traceidratio":
      return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) });
    case void 0:
    case "parentbased_always_on":
    default:
      return new ParentBasedSampler({ root });
  }
}

function parseSamplerRatio(value: string | undefined): number {
  const ratio = Number(value);
  return Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? ratio : 1;
}
