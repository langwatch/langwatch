/**
 * Metrics for one Node process (ADR-175): one provider, pushed over OTLP to a set collector and
 * pulled on its own port when `OTEL_METRICS_EXPORTER` lists `prometheus`. main's health-door
 * `/metrics` stays while `METRICS_API_KEY` is set and no exporter list is (Q3).
 */
import { metrics } from "@opentelemetry/api";
import { HostMetrics } from "@opentelemetry/host-metrics";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { AggregationType, MeterProvider, type MetricReader } from "@opentelemetry/sdk-metrics";

import { activateMetrics, deactivateMetrics, metricHistogramViews } from "../metrics/index.ts";
import { installNodeDefaultMetrics, withRegistryFamilies } from "./node-default-metrics.ts";
import { otlpMetricReader } from "./otlp-metrics.ts";
import { PrometheusPullReader } from "./prometheus-exposition.ts";
import { prometheusMetrics, prometheusPullListener } from "./prometheus-metrics-door.ts";
import { type ResolvedTelemetry, resolveTelemetry } from "./telemetry-aliases.ts";
import {
  metricsScrapeTokenSecret,
  otlpHeadersFrom,
  otlpHeadersSecret,
  resourceAttributesFrom,
  type TelemetryContext,
  type TelemetrySettings,
} from "./telemetry-settings.ts";

/** The OTel default for `OTEL_EXPORTER_PROMETHEUS_PORT`. */
const DEFAULT_PROMETHEUS_PORT = 9464;

/** What the preamble hosts: lifecycle components, a health-door route, or both. */
type MetricsContribution =
  | Readonly<{ name: string; start?: () => Promise<void>; stop: () => Promise<void> }>
  | ReturnType<typeof prometheusMetrics>;

/** What this needs of the preamble's logger: a door unmounted or kept for main is named at boot. */
type BootLogger = Readonly<{
  error: (obj: object, msg: string) => void;
  warn?: (obj: object, msg: string) => void;
}>;

type MetricsContext = TelemetryContext & Readonly<{ logger?: BootLogger }>;

/** Where the pull reader is served: its own listener, main's health-door route, or nowhere. */
type Door = "own" | "health" | undefined;

export function processMetrics(serviceName: string) {
  return async ({
    config,
    secrets,
    logger,
  }: MetricsContext): Promise<readonly MetricsContribution[]> => {
    const settings = config.observability;
    const resolved = resolveTelemetry(settings);
    const name = resolved.serviceName ?? serviceName;
    const production = config.process?.nodeEnvironment === "production";

    return secrets.into(otlpHeadersSecret, (rawHeaders) =>
      secrets.into(metricsScrapeTokenSecret, (token) =>
        composeMetrics({
          serviceName: name,
          settings,
          resolved,
          headers: otlpHeadersFrom(rawHeaders),
          token,
          door: doorFor({ serviceName: name, resolved, token, production, logger }),
        }),
      ),
    );
  };
}

function doorFor({
  serviceName,
  resolved,
  token,
  production,
  logger,
}: {
  serviceName: string;
  resolved: ResolvedTelemetry;
  token: string | undefined;
  production: boolean;
  logger: BootLogger | undefined;
}): Door {
  if (!resolved.metrics.enabled) return undefined;
  if (resolved.metrics.pull) {
    // An unset key in production is a misconfiguration, not an invitation.
    if (token !== undefined || !production) return "own";
    logger?.error(
      { setting: metricsScrapeTokenSecret.id },
      `${serviceName}: /metrics is not mounted: ${metricsScrapeTokenSecret.id} is not set in production`,
    );
    return undefined;
  }
  if (!resolved.metrics.healthDoor || token === undefined) return undefined;
  logger?.warn?.(
    { setting: "OTEL_METRICS_EXPORTER" },
    `${serviceName}: /metrics on the health door is deprecated; set OTEL_METRICS_EXPORTER=otlp,prometheus and scrape port ${DEFAULT_PROMETHEUS_PORT}`,
  );
  return "health";
}

function composeMetrics({
  serviceName,
  settings,
  resolved,
  headers,
  token,
  door,
}: {
  serviceName: string;
  settings: TelemetrySettings;
  resolved: ResolvedTelemetry;
  headers: Readonly<Record<string, string>>;
  token: string | undefined;
  door: Door;
}): readonly MetricsContribution[] {
  const { endpoint } = resolved.metrics;
  const pull = door === undefined ? undefined : new PrometheusPullReader();
  const readers: MetricReader[] = [
    ...(endpoint === undefined ? [] : [otlpMetricReader({ endpoint, headers })]),
    ...(pull === undefined ? [] : [pull]),
  ];
  if (readers.length === 0) return [inert()];

  const meterProvider = meterProviderOver({ readers, serviceName, settings });
  metrics.setGlobalMeterProvider(meterProvider);
  activateMetrics();
  new HostMetrics({ meterProvider, name: serviceName }).start();
  const lifecycle: MetricsContribution = {
    name: "process metrics",
    stop: async () => {
      await meterProvider.shutdown();
      metrics.disable();
      deactivateMetrics();
    },
  };
  if (pull === undefined) return [lifecycle];

  installNodeDefaultMetrics();
  const route = prometheusMetrics({
    ...(token === undefined ? {} : { token }),
    readMetrics: async () => withRegistryFamilies(await pull.read()),
  });
  if (door === "health") return [lifecycle, route];
  const { prometheusHost, prometheusPort } = settings.metrics;
  return [
    lifecycle,
    prometheusPullListener({
      route,
      host: prometheusHost,
      port: prometheusPort ?? DEFAULT_PROMETHEUS_PORT,
    }),
  ];
}

/**
 * Bucket boundaries belong to the provider, not the instrument: without these
 * views every histogram takes the SDK's generic 0…10000 boundaries and
 * `histogram_quantile` returns nonsense.
 */
function meterProviderOver({
  readers,
  serviceName,
  settings,
}: {
  readers: MetricReader[];
  serviceName: string;
  settings: TelemetrySettings;
}): MeterProvider {
  return new MeterProvider({
    resource: resourceFromAttributes({
      ...resourceAttributesFrom(settings.resourceAttributes),
      "service.name": serviceName,
      "deployment.environment.name": settings.environment,
    }),
    views: metricHistogramViews().map(({ instrumentName, boundaries }) => ({
      instrumentName,
      aggregation: {
        type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
        options: { boundaries: [...boundaries], recordMinMax: true },
      },
    })),
    readers,
  });
}

/** A process that exports no metrics still hosts something, so the order reads the same. */
const inert = (): MetricsContribution => ({
  name: "process metrics",
  stop: () => Promise.resolve(),
});
