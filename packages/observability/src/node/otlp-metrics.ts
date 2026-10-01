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

import { activateMetrics, metricHistogramViews } from "../metrics/index.ts";
import { createAuthoritativeOtlpConfiguration } from "./otlp-configuration.ts";
import type { ProcessObservabilityFlusher } from "./process-observability.ts";

/** How often a started export pushes; the collector's scrape interval matches. */
const EXPORT_INTERVAL_MS = 15_000;

/**
 * What a process must have decided before its metrics can be exported —
 * all semantic, parsed from environment once. Nothing here reads
 * `process.env`, which stops a stale value arriving via the OTel SDK's own ambient reading.
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
 * Starts the process's OTLP metrics push: returns a flusher for shutdown
 * draining. Metrics are their own MeterProvider, so `activateMetrics()` must be
 * called after the provider is installed.
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
    // Bucket boundaries are a property of the provider here, not the
    // instrument. Without these views, every histogram takes the SDK's
    // generic 0…10000 boundaries and `histogram_quantile` returns nonsense.
    // They live beside the recording instruments in metrics/index.ts, so the two can't drift.
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
 * The telemetry a metrics export is projected from: structural, not imported
 * from config to keep observability below configuration.
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
 * Folds a process's resolved telemetry into the export's options: one place so
 * new fields land once, not drifting between processes.
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
