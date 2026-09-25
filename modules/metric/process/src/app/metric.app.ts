import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { EventingCommands } from "@langwatch/eventing";
import type { FeatureSetup } from "@langwatch/kernel";
import {
  MetricApi,
  METRIC_DEFAULT_RETENTION_DAYS,
  metricConfig,
  type CanonicalMetricDataPoint,
  type MetricApi as MetricApiContract,
  type MetricDataPointPreparation,
  type MetricOtlpDoorResult,
  type MetricPiiRedactionLevel,
  type MetricServerConfig,
} from "@langwatch/metric-contract";
import type { OtlpDoorRequest } from "@langwatch/otlp";
import { TraceApi } from "@langwatch/trace-contract";

import {
  ClickHouseMetricDataPointAppendRepository,
  createMetricClickHouseResolver,
} from "../repositories/clickhouse/clickhouse.metric-data-point-append.repository.ts";
import { resolveMetricCommandShardCount } from "../rules/metric-command-lanes.rules.ts";
import { CanonicalMetricService } from "../services/canonical-metric.service.ts";
import {
  MetricProcessingService,
  type MetricProcessingPipeline,
} from "../services/metric-processing.service.ts";
import { MetricRequestCollectionService } from "../services/metric-request-collection.service.ts";
import { MetricService } from "../services/metric.service.ts";
import { OtlpMetricReceiverService } from "../services/otlp-metric-receiver.service.ts";

export type MetricInfrastructure = Readonly<{
  /** The process's one ClickHouse client, which routes each statement itself. */
  clickhouse: ClickHouseQueryClient;
}>;

type MetricDependencies = Readonly<{
  dataPrivacy: typeof DataPrivacyApi;
  traces: typeof TraceApi;
}>;
type MetricSetup = FeatureSetup<MetricDependencies, MetricInfrastructure, MetricServerConfig>;

/** The process-owned metric preparation capability, and its durable processing pipeline. */
export class MetricApp implements MetricApiContract {
  static readonly contract = MetricApi;
  static readonly config = metricConfig;
  static readonly dependencies: MetricDependencies = {
    dataPrivacy: DataPrivacyApi,
    traces: TraceApi,
  };
  /** The run this module's durable processing needs, over ClickHouse only. */
  static readonly reads = ["clickhouse"] as const;

  readonly #service: MetricService;
  readonly #pipeline: MetricProcessingPipeline;
  readonly #receiver: OtlpMetricReceiverService;
  #commands: EventingCommands<MetricProcessingPipeline> | undefined;

  private constructor(
    service: MetricService,
    pipeline: MetricProcessingPipeline,
    receiver: OtlpMetricReceiverService,
  ) {
    this.#service = service;
    this.#pipeline = pipeline;
    this.#receiver = receiver;
  }

  static create({ dependencies, members, config }: MetricSetup): MetricApp {
    const preparation = CanonicalMetricService.create({ redaction: dependencies.dataPrivacy });
    const pipeline = MetricProcessingService.create({
      repository: ClickHouseMetricDataPointAppendRepository.create({
        resolveClient: createMetricClickHouseResolver(members.clickhouse),
        defaultRetentionDays: METRIC_DEFAULT_RETENTION_DAYS,
      }),
      defaultRetentionDays: METRIC_DEFAULT_RETENTION_DAYS,
      metricCommandShardCount: resolveMetricCommandShardCount(config.processingShards),
    }).build();
    const service = MetricService.create({ preparation });
    const app: MetricApp = new MetricApp(
      service,
      pipeline,
      OtlpMetricReceiverService.create({
        traces: dependencies.traces,
        collection: MetricRequestCollectionService.create({
          traces: dependencies.traces,
          metrics: service,
          recordDataPoints: (points) => app.recordCanonicalMetricDataPoints(points),
        }),
      }),
    );
    return app;
  }

  prepareMetricDataPoints(input: {
    tenantId: string;
    organizationId: string;
    request: unknown;
    piiRedactionLevel: MetricPiiRedactionLevel;
    acceptedAt?: number;
  }): Promise<MetricDataPointPreparation> {
    return this.#service.prepareMetricDataPoints(input);
  }

  receiveOtlpMetrics(request: OtlpDoorRequest): Promise<MetricOtlpDoorResult> {
    return this.#receiver.receive(request);
  }

  async recordCanonicalMetricDataPoints(
    points: readonly CanonicalMetricDataPoint[],
  ): Promise<void> {
    if (points.length === 0) return;
    if (!this.#commands) {
      throw new Error("metric_processing pipeline senders are not connected yet");
    }
    await this.#commands.recordDataPoint.sendBatch([...points]);
  }

  /** The pipeline this module registers, built once by {@link create}. */
  eventingPipeline(): MetricProcessingPipeline {
    return this.#pipeline;
  }

  /** Binds the built pipeline's own senders; every write goes through them. */
  connectCommands(commands: EventingCommands<MetricProcessingPipeline>): void {
    this.#commands = commands;
  }
}
