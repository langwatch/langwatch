import type { EventSubscriberDefinition } from "@langwatch/eventing";
import type {
  MetricProcessingEvent,
  MetricService as MetricServiceContract,
} from "@langwatch/metric-contract";
import type { MetricRedactionPort } from "../ports/metric-redaction.port";
import { CanonicalMetricAdapter } from "./canonical-metric.adapter";
import {
  MetricProcessingAdapter,
  type MetricProcessingPipeline,
} from "./metric-processing.adapter";
import { MetricService } from "../services/metric.service";
import type { MetricDataPointRepository } from "../repositories/metric-data-point.repository";
import type { MetricClickHouseClientResolver } from "../repositories/clickhouse/clickhouse.metric-data-point-append.repository";
import { MetricDataPointClickHouseRepository } from "../repositories/clickhouse/clickhouse.metric-data-point.repository";
import { NullMetricDataPointRepository } from "../repositories/null/null.metric-data-point.repository";

/** Process composition for the metric service and its durable processing pipeline. */
export class MetricRuntimeAdapter {
  private constructor(
    private readonly service: MetricServiceContract,
    private readonly repository: MetricDataPointRepository,
    private readonly defaultRetentionDays: number,
    private readonly metricCommandShardCount: number,
  ) {}

  static create(options: {
    resolveClient: MetricClickHouseClientResolver;
    resolveOrganizationClient: MetricClickHouseClientResolver;
    defaultRetentionDays: number;
    metricCommandShardCount: number;
    redaction: MetricRedactionPort;
  }): MetricRuntimeAdapter {
    const repository = MetricDataPointClickHouseRepository.create(options);
    const service = MetricService.create({
      preparation: CanonicalMetricAdapter.create({ redaction: options.redaction }),
    });
    return new MetricRuntimeAdapter(
      service,
      repository,
      options.defaultRetentionDays,
      options.metricCommandShardCount,
    );
  }

  static createUnavailable(options: {
    defaultRetentionDays: number;
    metricCommandShardCount: number;
    redaction: MetricRedactionPort;
  }): MetricRuntimeAdapter {
    const repository = NullMetricDataPointRepository.create();
    const service = MetricService.create({
      preparation: CanonicalMetricAdapter.create({ redaction: options.redaction }),
    });
    return new MetricRuntimeAdapter(
      service,
      repository,
      options.defaultRetentionDays,
      options.metricCommandShardCount,
    );
  }

  getService(): MetricServiceContract {
    return this.service;
  }

  buildProcessing(options?: {
    subscribers?: EventSubscriberDefinition<MetricProcessingEvent>[];
  }): MetricProcessingPipeline {
    return MetricProcessingAdapter.create({
      repository: this.repository,
      defaultRetentionDays: this.defaultRetentionDays,
      metricCommandShardCount: this.metricCommandShardCount,
      subscribers: options?.subscribers,
    }).build();
  }
}
