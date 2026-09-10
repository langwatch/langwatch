import type { EventSubscriberDefinition } from "@langwatch/eventing";
import type { MetricProcessingEvent } from "@langwatch/metric-contract";
import {
  ClickHouseMetricDataPointAppendRepository,
  type MetricClickHouseClientResolver,
} from "./clickhouse.metric-data-point-append.repository.ts";
import {
  MetricProcessingAdapter,
  type MetricProcessingPipeline,
} from "../../adapters/metric-processing.adapter.ts";

/**
 * Durable metric processing, composed from nothing but a tenant-keyed
 * ClickHouse client — the whole seam a background worker needs. The redaction
 * policy and the organization-keyed read client an HTTP door needs stay off
 * this path, because demanding them is what kept the pipeline unbuildable
 * outside the App.
 */
export class ClickhouseMetricProcessingRepository {
  private constructor(
    private readonly repository: ClickHouseMetricDataPointAppendRepository,
    private readonly metricCommandShardCount: number,
    private readonly defaultRetentionDays: number,
  ) {}

  static create(options: {
    resolveClient: MetricClickHouseClientResolver;
    /** The fallback for rows whose tenant declares no retention override. */
    defaultRetentionDays: number;
    metricCommandShardCount: number;
  }): ClickhouseMetricProcessingRepository {
    return new ClickhouseMetricProcessingRepository(
      ClickHouseMetricDataPointAppendRepository.create({
        resolveClient: options.resolveClient,
        defaultRetentionDays: options.defaultRetentionDays,
      }),
      options.metricCommandShardCount,
      options.defaultRetentionDays,
    );
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
