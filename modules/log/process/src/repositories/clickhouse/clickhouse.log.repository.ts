import type { EventSubscriberDefinition } from "@langwatch/eventing";
import type { LogProcessingEvent } from "@langwatch/log-contract";

import type { LogRedaction } from "../../app/log.members.ts";
import { LogProcessingAdapter, type LogProcessingPipeline } from "../../eventing/log.pipeline.ts";
import { CanonicalLogAdapter } from "../../services/canonical-log.service.ts";
import { LogService } from "../../services/log.service.ts";
import type { CanonicalLogRecordRepository } from "../canonical-log-record.repository.ts";
import { NullCanonicalLogRecordRepository } from "../null/null.canonical-log-record.repository.ts";
import type { LogClickHouseClientResolver } from "./clickhouse.canonical-log-record-append.repository.ts";
import { ClickHouseCanonicalLogRecordRepository } from "./clickhouse.canonical-log-record.repository.ts";

/**
 * Process composition for the log preparation/read service and its durable
 * processing pipeline. `LogService` covers preparation and the trace-scoped
 * read; the pipeline-sender capability lives one level up, on `LogApp`, since
 * only the process knows the senders the runtime hands back at `connect`.
 */
export class ClickhouseLogRepository {
  private constructor(
    private readonly service: LogService,
    private readonly repository: CanonicalLogRecordRepository,
    private readonly defaultRetentionDays: number,
    private readonly logCommandShardCount: number,
  ) {}

  static create(options: {
    resolveClient: LogClickHouseClientResolver;
    defaultRetentionDays: number;
    defaultReadLimit: number;
    logCommandShardCount: number;
    redaction: LogRedaction;
  }): ClickhouseLogRepository {
    const repository = ClickHouseCanonicalLogRecordRepository.create(options);
    const service = LogService.create({
      preparation: CanonicalLogAdapter.create({ redaction: options.redaction }),
      repository,
    });
    return new ClickhouseLogRepository(
      service,
      repository,
      options.defaultRetentionDays,
      options.logCommandShardCount,
    );
  }

  static createUnavailable(options: {
    defaultRetentionDays: number;
    logCommandShardCount: number;
    redaction: LogRedaction;
  }): ClickhouseLogRepository {
    const repository = NullCanonicalLogRecordRepository.create();
    const service = LogService.create({
      preparation: CanonicalLogAdapter.create({ redaction: options.redaction }),
      repository,
    });
    return new ClickhouseLogRepository(
      service,
      repository,
      options.defaultRetentionDays,
      options.logCommandShardCount,
    );
  }

  getService(): LogService {
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
