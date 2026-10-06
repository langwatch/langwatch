/**
 * Metrics for one Node process, in whichever of the two transports the
 * deployment chose. Under `otlp` — the default — the process pushes and no
 * scrape door is mounted; under `prometheus` the door is mounted and read.
 */
import { metrics } from "@opentelemetry/api";
import { HostMetrics } from "@opentelemetry/host-metrics";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { AggregationType, MeterProvider } from "@opentelemetry/sdk-metrics";

import { activateMetrics, deactivateMetrics, metricHistogramViews } from "../metrics/index.ts";
import { installNodeDefaultMetrics, withRegistryFamilies } from "./node-default-metrics.ts";
import { startOtlpMetricsExport } from "./otlp-metrics.ts";
import { PrometheusPullReader } from "./prometheus-exposition.ts";
import { prometheusMetrics } from "./prometheus-metrics-door.ts";
import {
  metricsScrapeTokenSecret,
  otlpHeadersFrom,
  otlpHeadersSecret,
  resourceAttributesFrom,
  type TelemetryContext,
  type TelemetrySettings,
} from "./telemetry-settings.ts";

/** What the preamble hosts: a lifecycle component, a scrape route, or both. */
type MetricsContribution =
  | Readonly<{ name: string; stop: () => Promise<void> }>
  | ReturnType<typeof prometheusMetrics>;

/** What this needs of the preamble's logger: a door left unmounted is named in the boot log. */
type BootLogger = Readonly<{ error: (obj: object, msg: string) => void }>;

type MetricsContext = TelemetryContext & Readonly<{ logger?: BootLogger }>;

export function processMetrics(serviceName: string) {
  return async ({
    config,
    secrets,
    logger,
  }: MetricsContext): Promise<readonly MetricsContribution[]> => {
    const settings = config.observability;

    if (settings.metrics.mode === "prometheus") {
      const production = config.process?.nodeEnvironment === "production";
      return secrets.into(metricsScrapeTokenSecret, (token) =>
        scrapeDoor({ serviceName, settings, token, production, logger }),
      );
    }

    return secrets.into(otlpHeadersSecret, (rawHeaders) =>
      otlpPush({ serviceName, settings, headers: otlpHeadersFrom(rawHeaders) }),
    );
  };
}

function otlpPush({
  serviceName,
  settings,
  headers,
}: {
  serviceName: string;
  settings: TelemetrySettings;
  headers: Readonly<Record<string, string>>;
}): readonly MetricsContribution[] {
  const flusher = startOtlpMetricsExport({
    endpoint: settings.otlpEndpoint,
    enabled: settings.metrics.enabled,
    headers,
    resourceAttributes: resourceAttributesFrom(settings.resourceAttributes),
    serviceName,
    deploymentEnvironment: settings.environment,
  });

  if (flusher === undefined) return [inert()];

  return [{ name: "process metrics", stop: () => flusher.shutdown() }];
}

function scrapeDoor({
  serviceName,
  settings,
  token,
  production,
  logger,
}: {
  serviceName: string;
  settings: TelemetrySettings;
  token: string | undefined;
  production: boolean;
  logger: BootLogger | undefined;
}): readonly MetricsContribution[] {
  if (!settings.metrics.enabled) return [inert()];
  // An unset token in production is a misconfiguration, not an invitation.
  if (token === undefined && production) {
    logger?.error(
      { setting: metricsScrapeTokenSecret.id },
      `${serviceName}: /metrics is not mounted: ${metricsScrapeTokenSecret.id} is not set in production`,
    );
    return [inert()];
  }

  const reader = new PrometheusPullReader();
  const meterProvider = meterProviderOver({ reader, serviceName, settings });
  metrics.setGlobalMeterProvider(meterProvider);
  activateMetrics();
  new HostMetrics({ meterProvider, name: serviceName }).start();
  installNodeDefaultMetrics();

  return [
    {
      name: "process metrics",
      stop: async () => {
        await meterProvider.shutdown();
        metrics.disable();
        deactivateMetrics();
      },
    },
    prometheusMetrics({
      ...(token === undefined ? {} : { token }),
      readMetrics: async () => withRegistryFamilies(await reader.read()),
    }),
  ];
}

/**
 * Bucket boundaries belong to the provider, not the instrument: without these
 * views every histogram takes the SDK's generic 0…10000 boundaries and
 * `histogram_quantile` returns nonsense.
 */
function meterProviderOver({
  reader,
  serviceName,
  settings,
}: {
  reader: PrometheusPullReader;
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
    readers: [reader],
  });
}

/** A process that exports no metrics still hosts something, so the order reads the same. */
const inert = (): MetricsContribution => ({
  name: "process metrics",
  stop: () => Promise.resolve(),
});
