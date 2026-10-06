import { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EventingCommands } from "@langwatch/eventing";
import {
  MetricApi,
  METRIC_DEFAULT_RETENTION_DAYS,
  metricConfig,
  type CanonicalMetricDataPoint,
  type MetricApi as MetricApiContract,
  type MetricCollectionInput,
  type MetricRequestCollectionResult,
  type MetricDataPointPreparation,
  type MetricOtlpDoorResult,
  type MetricPiiRedactionLevel,
  type MetricServerConfig,
} from "@langwatch/metric-contract";
import type { OtlpDoorRequest } from "@langwatch/otlp";
import type { FeatureSetup } from "@langwatch/process";
import { TraceApi } from "@langwatch/trace-contract";

import {
  buildMetricProcessingPipeline,
  type MetricProcessingPipeline,
} from "../eventing/metric.pipeline.ts";
import type { MetricRepositories } from "../repositories/metric.repositories.ts";
import { resolveMetricCommandShardCount } from "../rules/metric-command-lanes.rules.ts";
import { CanonicalMetricService } from "../services/canonical-metric.service.ts";
import { MetricRequestCollectionService } from "../services/metric-request-collection.service.ts";
import { MetricService } from "../services/metric.service.ts";
import { OtlpMetricReceiverService } from "../services/otlp-metric-receiver.service.ts";

type MetricDependencies = Readonly<{
  dataPrivacy: typeof DataPrivacyApi;
  traces: typeof TraceApi;
  retention: typeof DataRetentionApi;
}>;
type MetricSetup = FeatureSetup<MetricDependencies, never, MetricServerConfig, MetricRepositories>;

/** The process-owned metric preparation capability, and its durable processing pipeline. */
export class MetricModule implements MetricApiContract {
  static readonly contract = MetricApi;
  static readonly config = metricConfig;
  static readonly dependencies: MetricDependencies = {
    dataPrivacy: DataPrivacyApi,
    traces: TraceApi,
    /** Each tenant's retention, which the metric rows are stamped with. */
    retention: DataRetentionApi,
  };

  readonly #service: MetricService;
  readonly #pipeline: MetricProcessingPipeline;
  readonly #receiver: OtlpMetricReceiverService;
  readonly #collection: MetricRequestCollectionService;
  #commands: EventingCommands<MetricProcessingPipeline> | undefined;

  private constructor(parts: {
    service: MetricService;
    pipeline: MetricProcessingPipeline;
    receiver: OtlpMetricReceiverService;
    collection: MetricRequestCollectionService;
  }) {
    this.#service = parts.service;
    this.#pipeline = parts.pipeline;
    this.#receiver = parts.receiver;
    this.#collection = parts.collection;
  }

  static create({ dependencies, repositories, config }: MetricSetup): MetricModule {
    const preparation = CanonicalMetricService.create({ redaction: dependencies.dataPrivacy });
    const pipeline = buildMetricProcessingPipeline({
      repository: repositories.dataPoints,
      defaultRetentionDays: METRIC_DEFAULT_RETENTION_DAYS,
      metricCommandShardCount: resolveMetricCommandShardCount(config.processingShards),
      retention: {
        resolve: (tenantId) =>
          dependencies.retention.getResolvedForProject({ projectId: tenantId }),
      },
    });
    const service = MetricService.create({ preparation });
    const collection = MetricRequestCollectionService.create({
      traces: dependencies.traces,
      metrics: service,
      recordDataPoints: (points) => app.recordCanonicalMetricDataPoints(points),
    });
    const app: MetricModule = new MetricModule({
      service,
      pipeline,
      receiver: OtlpMetricReceiverService.create({ traces: dependencies.traces, collection }),
      collection,
    });
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

  collectOtlpMetrics(input: MetricCollectionInput): Promise<MetricRequestCollectionResult> {
    return this.#collection.handleOtlpMetricRequest(input);
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
