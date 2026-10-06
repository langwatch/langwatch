import { createLogger } from "@langwatch/observability";
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
  collectorTargetOf,
  DEPRECATED_COLLECTOR_VARIABLES,
} from "../rules/rum-ingest.rules.ts";
import {
  BrowserTraceIngestService,
  type RumCollector,
} from "../services/browser-trace-ingest.service.ts";

type RumSetup = FeatureSetup<typeof RumModule.dependencies, never, RumConfig, RumRepositories>;

/** The process-owned browser telemetry ingest capability (ADR-058). */
export class RumModule implements RumApiContract {
  static readonly contract = RumApi;
  static readonly dependencies = {};
  static readonly config = rumConfig;
  static readonly publicConfig = rumBrowserConfig.project;
  static readonly secrets = rumSecrets;

  readonly #ingest: BrowserTraceIngestService;

  private constructor(ingest: BrowserTraceIngestService) {
    this.#ingest = ingest;
  }

  static async create({ config, secrets, repositories }: RumSetup): Promise<RumModule> {
    const target = await secrets.into(RumModule.secrets.collectorHeaders, (rawHeaders) =>
      secrets.into(RumModule.secrets.telemetryHeaders, (rawTelemetryHeaders) =>
        collectorTargetOf({
          own: { endpoint: config.collectorEndpoint, headers: collectorHeaders(rawHeaders) },
          telemetry: {
            endpoint: config.telemetryEndpoint,
            headers: collectorHeaders(rawTelemetryHeaders),
          },
        }),
      ),
    );
    if (target.configured && target.deprecated) {
      createLogger("langwatch:rum").warn(
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
