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

import type { RumChannels } from "../channels/rum.channels.ts";
import type { RumRepositories } from "../repositories/rum.repositories.ts";
import { BrowserTraceIngestService } from "../services/browser-trace-ingest.service.ts";

type RumSetup = FeatureSetup<
  typeof RumModule.dependencies,
  RumConfig,
  RumRepositories,
  RumChannels
>;

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

  static async create({ channels, repositories }: RumSetup): Promise<RumModule> {
    return new RumModule(
      BrowserTraceIngestService.create({
        rateLimits: repositories.rateLimits,
        collector: channels.collector,
      }),
    );
  }

  ingestBrowserTraces(report: BrowserTraceReport): Promise<void> {
    return this.#ingest.ingest(report);
  }
}
