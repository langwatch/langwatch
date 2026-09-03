import { metrics } from "@opentelemetry/api";
import { OTLPMetricExporterBase } from "@opentelemetry/exporter-metrics-otlp-http";
import { HostMetrics } from "@opentelemetry/host-metrics";
import { getSharedConfigurationDefaults } from "@opentelemetry/otlp-exporter-base";
import {
  createOtlpHttpExportDelegate,
  httpAgentFactoryFromOptions,
} from "@opentelemetry/otlp-exporter-base/node-http";
import {
  MetricsExporterMetricsHelper,
  ProtobufMetricsSerializer,
} from "@opentelemetry/otlp-transformer-telemetry";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  AggregationType,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { activateMetrics, metricHistogramViews } from "../metrics";
import type { ProcessObservabilityFlusher } from "./process-observability";
import { createAuthoritativeOtlpConfiguration } from "./otlp-configuration";

/** How often a started export pushes; the collector's scrape interval matches. */
const EXPORT_INTERVAL_MS = 15_000;

/**
 * What a process must have decided before its metrics can be exported.
 *
 * All of it is semantic: the process parsed its own environment once and hands
 * over the result. Nothing here reads `process.env`, which is what stops a
 * second destination or a stale service name from arriving through the OTel
 * SDK's own ambient variable reading.
 */
export type OtlpMetricsExportOptions = Readonly<{
  /** The collector's base URL; absent means this process exports no metrics. */
  endpoint: string | undefined;
  /** The operator's switch. Absent endpoint and disabled are both "off". */
  enabled: boolean;
  /** The headers the collector authenticates this process by. */
  headers: Readonly<Record<string, string>>;
  /** Resource attributes, already parsed out of their environment encoding. */
  resourceAttributes: Readonly<Record<string, string>>;
  /** The identity every series is attributed to. */
  serviceName: string;
  /** Which install this is; absent leaves the dimension off rather than blank. */
  deploymentEnvironment: string | undefined;
}>;

/**
 * Starts the process's OTLP metrics push, or reports that it did not.
 *
 * Metrics are their own MeterProvider rather than a reader inside the traces
 * SDK: the instruments in `@langwatch/observability/metrics` resolve a meter at
 * module scope, and `metrics.getMeter()` — unlike `trace.getTracer()` — has no
 * upgrading proxy, so they hold a no-op meter until a provider is installed
 * globally and `activateMetrics()` drains the observable gauges that had
 * nowhere to register. That ordering is the whole reason this is a function a
 * process calls at boot rather than a module side effect.
 *
 * Returns a flusher so the export is drained as a phase of the process's own
 * shutdown sequence. It must never install a signal handler of its own: Node
 * runs every listener for a signal, so a handler here would race the drain
 * rather than participate in it, and the last periodic export would be lost
 * whenever the exit won.
 */
export function startOtlpMetricsExport(
  options: OtlpMetricsExportOptions,
): ProcessObservabilityFlusher | undefined {
  const { endpoint } = options;
  if (!endpoint || !options.enabled) return undefined;

  const attributes: Record<string, string> = {
    ...options.resourceAttributes,
    "service.name": options.serviceName,
  };
  if (options.deploymentEnvironment) {
    attributes["deployment.environment.name"] = options.deploymentEnvironment;
  }

  const meterProvider = new MeterProvider({
    resource: resourceFromAttributes(attributes),
    // Bucket boundaries are a property of the provider in OpenTelemetry, not
    // of the instrument the way prom-client's `buckets` were. Without these
    // views every histogram takes the SDK's generic 0…10000 boundaries, and
    // `histogram_quantile` over payload sizes, span counts or multi-minute
    // jobs returns plausible nonsense. The boundaries live beside the
    // instruments that record into them, so the two cannot drift.
    views: metricHistogramViews().map(({ instrumentName, boundaries }) => ({
      instrumentName,
      aggregation: {
        type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
        options: { boundaries: [...boundaries], recordMinMax: true },
      },
    })),
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporterBase(
          createOtlpHttpExportDelegate(
            createAuthoritativeOtlpConfiguration({
              url: `${endpoint}/v1/metrics`,
              headers: options.headers,
              contentType: "application/x-protobuf",
              getDefaults: getSharedConfigurationDefaults,
              agentFactoryFromOptions: httpAgentFactoryFromOptions,
            }),
            ProtobufMetricsSerializer,
            "otlp_http_metric_exporter",
            MetricsExporterMetricsHelper,
            void 0,
          ),
        ),
        exportIntervalMillis: EXPORT_INTERVAL_MS,
      }),
    ],
  });

  metrics.setGlobalMeterProvider(meterProvider);
  activateMetrics();

  new HostMetrics({ meterProvider, name: options.serviceName }).start();

  return {
    name: "metrics",
    shutdown: async () => {
      await meterProvider.forceFlush();
    },
  };
}

/**
 * The telemetry leaves a metrics export is projected from.
 *
 * Structural rather than an import of `@langwatch/config`'s `TelemetryConfig`:
 * observability is below configuration, and a package that named the config
 * type would invert that. Every field here is one a process has already
 * parsed, so the shape is satisfied by passing the resolved telemetry value
 * straight in.
 */
export type OtlpMetricsTelemetryInputs = Readonly<{
  otlpEndpoint: string | undefined;
  metricsEnabled: boolean;
  otlpHeaders: Readonly<Record<string, string>>;
  otlpMetricsHeaders: Readonly<Record<string, string>>;
  resourceAttributesMap: Readonly<Record<string, string>>;
  deploymentEnvironment: string | undefined;
}>;

/**
 * Folds a process's resolved telemetry into the export's options.
 *
 * One place, so a new leaf lands once instead of drifting between the API and
 * the worker. The signal-specific headers win over the shared ones exactly as
 * the OTLP specification orders them, and `serviceName` comes from the
 * process's own identity rather than from `OTEL_SERVICE_NAME`, because that is
 * the name its logs and traces already carry.
 */
export function otlpMetricsExportOptionsFrom({
  telemetry,
  serviceName,
}: {
  telemetry: OtlpMetricsTelemetryInputs;
  serviceName: string;
}): OtlpMetricsExportOptions {
  return {
    endpoint: telemetry.otlpEndpoint,
    enabled: telemetry.metricsEnabled,
    headers: { ...telemetry.otlpHeaders, ...telemetry.otlpMetricsHeaders },
    resourceAttributes: telemetry.resourceAttributesMap,
    serviceName,
    deploymentEnvironment: telemetry.deploymentEnvironment,
  };
}
