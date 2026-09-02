import type { EventSubscriberDefinition } from "@langwatch/eventing";
import type { LogProcessingEvent } from "@langwatch/log-contract";
import {
  ClickHouseCanonicalLogRecordAppendRepository,
  type LogClickHouseClientResolver,
} from "../repositories/clickhouse/clickhouse.canonical-log-record-append.repository";
import { LogProcessingAdapter, type LogProcessingPipeline } from "./log-processing.adapter";

/**
 * Durable log processing, composed from nothing but a tenant-keyed ClickHouse
 * client.
 *
 * This is the whole seam a background worker needs. {@link LogRuntimeAdapter}
 * composes the same pipeline alongside the ingestion service, its redaction
 * policy and the trace-scoped read cap — everything an HTTP door needs and a
 * queue consumer does not. Asking for those anyway is what kept the pipeline
 * unbuildable outside the App, so this adapter states the consumer's
 * dependencies instead of inheriting the producer's.
 */
export class ClickHouseLogProcessingAdapter {
  private constructor(
    private readonly repository: ClickHouseCanonicalLogRecordAppendRepository,
    private readonly logCommandShardCount: number,
    private readonly defaultRetentionDays: number,
  ) {}

  static create(options: {
    resolveClient: LogClickHouseClientResolver;
    /** The fallback for rows whose tenant declares no retention override. */
    defaultRetentionDays: number;
    logCommandShardCount: number;
  }): ClickHouseLogProcessingAdapter {
    return new ClickHouseLogProcessingAdapter(
      ClickHouseCanonicalLogRecordAppendRepository.create({
        resolveClient: options.resolveClient,
        defaultRetentionDays: options.defaultRetentionDays,
      }),
      options.logCommandShardCount,
      options.defaultRetentionDays,
    );
  }

  buildProcessing(options?: {
    subscribers?: EventSubscriberDefinition<LogProcessingEvent>[];
  }): LogProcessingPipeline {
    return LogProcessingAdapter.create({
      repository: this.repository,
      defaultRetentionDays: this.defaultRetentionDays,
      logCommandShardCount: this.logCommandShardCount,
      subscribers: options?.subscribers,
    }).build();
  }
}
