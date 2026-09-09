import type { EventSubscriberDefinition } from "@langwatch/eventing";
import type { LogApi, LogProcessingEvent } from "@langwatch/log-contract";
import type { LogRedactionPort } from "../ports/log-redaction.port.ts";
import { CanonicalLogAdapter } from "./canonical-log.adapter.ts";
import { LogProcessingAdapter, type LogProcessingPipeline } from "./log-processing.adapter.ts";
import { LogService } from "../services/log.service.ts";
import type { CanonicalLogRecordRepository } from "../repositories/canonical-log-record.repository.ts";
import type { LogClickHouseClientResolver } from "../repositories/clickhouse/clickhouse.canonical-log-record-append.repository.ts";
import { ClickHouseCanonicalLogRecordRepository } from "../repositories/clickhouse/clickhouse.canonical-log-record.repository.ts";
import { NullCanonicalLogRecordRepository } from "../repositories/null/null.canonical-log-record.repository.ts";

/** Process composition for the log service and its durable processing pipeline. */
export class LogRuntimeAdapter {
  private constructor(
    private readonly service: LogApi,
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

  getService(): LogApi {
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
