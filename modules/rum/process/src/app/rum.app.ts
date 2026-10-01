import type { Logger } from "@langwatch/observability";
import type { FeatureSetup } from "@langwatch/process";
import {
  type BrowserTraceReport,
  RumApi,
  type RumApi as RumApiContract,
  type RumConfig,
  rumBrowserConfig,
  rumConfig,
  rumSecrets,
} from "@langwatch/rum-contract";

import { rumCollectorChannels } from "../channels/rum-collector-channels.registry.ts";
import type { RumRepositories } from "../repositories/rum.repositories.ts";
import {
  COLLECTOR_VARIABLES,
  collectorHeaders,
  collectorHeadersFrom,
  collectorTargetOf,
  DEPRECATED_COLLECTOR_VARIABLES,
} from "../rules/rum-ingest.rules.ts";
import {
  BrowserTraceIngestService,
  type RumCollector,
} from "../services/browser-trace-ingest.service.ts";

/**
 * Shapes restated rather than imported: a module depends on contracts. The
 * telemetry exporter is observability's `OTEL_EXPORTER_OTLP_*`, handed down by
 * the process; rum reads it only as the deprecated fallback.
 */
type RumMembers = Readonly<{
  logger: Pick<Logger, "warn">;
  telemetryExporter: Readonly<{
    endpoint: string | undefined;
    withHeaders: <Out>(build: (headers: Readonly<Record<string, string>>) => Out) => Out;
  }>;
}>;

type RumSetup = FeatureSetup<typeof RumModule.dependencies, RumMembers, RumConfig, RumRepositories>;

/** The process-owned browser telemetry ingest capability (ADR-058). */
export class RumModule implements RumApiContract {
  static readonly contract = RumApi;
  static readonly dependencies = {};
  static readonly config = rumConfig;
  static readonly publicConfig = rumBrowserConfig.project;
  static readonly secrets = rumSecrets;
  static readonly reads = ["logger", "telemetryExporter"] as const;

  readonly #ingest: BrowserTraceIngestService;

  private constructor(ingest: BrowserTraceIngestService) {
    this.#ingest = ingest;
  }

  static async create({ config, secrets, members, repositories }: RumSetup): Promise<RumModule> {
    const target = await secrets.into(RumModule.secrets.collectorHeaders, (rawHeaders) =>
      members.telemetryExporter.withHeaders((telemetryHeaders) =>
        collectorTargetOf({
          own: { endpoint: config.collectorEndpoint, headers: collectorHeaders(rawHeaders) },
          telemetry: {
            endpoint: members.telemetryExporter.endpoint,
            headers: collectorHeadersFrom(telemetryHeaders),
          },
        }),
      ),
    );
    if (target.configured && target.deprecated) {
      members.logger.warn(
        { deprecated: DEPRECATED_COLLECTOR_VARIABLES, replacements: COLLECTOR_VARIABLES },
        `Browser telemetry is forwarding to ${DEPRECATED_COLLECTOR_VARIABLES.join(" and ")}, which are deprecated for it; set ${COLLECTOR_VARIABLES.join(" and ")}`,
      );
    }
    const collector: RumCollector = target.configured
      ? {
          configured: true,
          channel: rumCollectorChannels.live.create({
            tracesUrl: target.tracesUrl,
            headers: target.headers,
          }),
        }
      : { configured: false };
    return new RumModule(
      BrowserTraceIngestService.create({ rateLimits: repositories.rateLimits, collector }),
    );
  }

  ingestBrowserTraces(report: BrowserTraceReport): Promise<void> {
    return this.#ingest.ingest(report);
  }
}
