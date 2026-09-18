import type { EventSubscriberDefinition } from "@langwatch/eventing";
import type { LogProcessingEvent } from "@langwatch/log-contract";
import {
  ClickHouseCanonicalLogRecordAppendRepository,
  type LogClickHouseClientResolver,
} from "./clickhouse.canonical-log-record-append.repository.ts";
import { LogProcessingAdapter, type LogProcessingPipeline } from "../../eventing/log.pipeline.ts";

/**
 * Durable log processing for background workers (append-only). States consumer's
 * dependencies: {@link LogRuntimeAdapter} adds ingestion, redaction, and read cap
 * alongside the same pipeline for HTTP doors.
 */
export class ClickhouseLogProcessingRepository {
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
  }): ClickhouseLogProcessingRepository {
    return new ClickhouseLogProcessingRepository(
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
