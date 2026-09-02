import type { EventSubscriberDefinition } from "@langwatch/eventing";
import type { MetricProcessingEvent } from "@langwatch/metric-contract";
import {
  ClickHouseMetricDataPointAppendRepository,
  type MetricClickHouseClientResolver,
} from "../repositories/clickhouse/clickhouse.metric-data-point-append.repository";
import {
  MetricProcessingAdapter,
  type MetricProcessingPipeline,
} from "./metric-processing.adapter";

/**
 * Durable metric processing, composed from nothing but a tenant-keyed
 * ClickHouse client.
 *
 * This is the whole seam a background worker needs. {@link MetricRuntimeAdapter}
 * composes the same pipeline alongside the ingestion service, its redaction
 * policy and the organization-keyed read client — everything an HTTP door
 * needs and a queue consumer does not. Asking for those anyway is what kept
 * the pipeline unbuildable outside the App, so this adapter states the
 * consumer's dependencies instead of inheriting the producer's.
 */
export class ClickHouseMetricProcessingAdapter {
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
  }): ClickHouseMetricProcessingAdapter {
    return new ClickHouseMetricProcessingAdapter(
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
