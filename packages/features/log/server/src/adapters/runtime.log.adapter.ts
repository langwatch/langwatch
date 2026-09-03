import type { EventSubscriberDefinition } from "@langwatch/eventing";
import type { LogProcessingEvent, LogService as LogServiceContract } from "@langwatch/log-contract";
import type { LogRedactionPort } from "../ports/log-redaction.port";
import { CanonicalLogAdapter } from "./canonical-log.adapter";
import { LogProcessingAdapter, type LogProcessingPipeline } from "./log-processing.adapter";
import { LogService } from "../services/log.service";
import type { CanonicalLogRecordRepository } from "../repositories/canonical-log-record.repository";
import type { LogClickHouseClientResolver } from "../repositories/clickhouse/clickhouse.canonical-log-record-append.repository";
import { ClickHouseCanonicalLogRecordRepository } from "../repositories/clickhouse/clickhouse.canonical-log-record.repository";
import { NullCanonicalLogRecordRepository } from "../repositories/null/null.canonical-log-record.repository";

/** Process composition for the log service and its durable processing pipeline. */
export class LogRuntimeAdapter {
  private constructor(
    private readonly service: LogServiceContract,
    private readonly repository: CanonicalLogRecordRepository,
    private readonly defaultRetentionDays: number,
    private readonly logCommandShardCount: number,
  ) {}

  static create(options: {
    resolveClient: LogClickHouseClientResolver;
    defaultRetentionDays: number;
    defaultReadLimit: number;
    logCommandShardCount: number;
    redaction: LogRedactionPort;
  }): LogRuntimeAdapter {
    const repository = ClickHouseCanonicalLogRecordRepository.create(options);
    const service = LogService.create({
      preparation: CanonicalLogAdapter.create({ redaction: options.redaction }),
      repository,
    });
    return new LogRuntimeAdapter(
      service,
      repository,
      options.defaultRetentionDays,
      options.logCommandShardCount,
    );
  }

  static createUnavailable(options: {
    defaultRetentionDays: number;
    logCommandShardCount: number;
    redaction: LogRedactionPort;
  }): LogRuntimeAdapter {
    const repository = NullCanonicalLogRecordRepository.create();
    const service = LogService.create({
      preparation: CanonicalLogAdapter.create({ redaction: options.redaction }),
      repository,
    });
    return new LogRuntimeAdapter(
      service,
      repository,
      options.defaultRetentionDays,
      options.logCommandShardCount,
    );
  }

  getService(): LogServiceContract {
    return this.service;
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
