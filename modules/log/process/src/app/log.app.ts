import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { EventingCommands } from "@langwatch/eventing";
import type { FeatureSetup } from "@langwatch/kernel";
import {
  LogApi,
  LOG_DEFAULT_READ_LIMIT,
  LOG_DEFAULT_RETENTION_DAYS,
  logConfig,
  type CanonicalLogRecord,
  type CanonicalTraceLogRecord,
  type LogApi as LogApiContract,
  type LogPiiRedactionLevel,
  type LogOtlpDoorResult,
  type LogPreparation,
  type LogServerConfig,
} from "@langwatch/log-contract";
import type { OtlpDoorRequest } from "@langwatch/otlp";
import { TraceApi } from "@langwatch/trace-contract";

import { LogProcessingAdapter, type LogProcessingPipeline } from "../eventing/log.pipeline.ts";
import { createLogClickHouseResolver } from "../repositories/clickhouse/clickhouse.canonical-log-record-append.repository.ts";
import { ClickHouseCanonicalLogRecordRepository } from "../repositories/clickhouse/clickhouse.canonical-log-record.repository.ts";
import { CanonicalLogService } from "../services/canonical-log.service.ts";
import { LogRequestCollectionService } from "../services/log-request-collection.service.ts";
import { LogService } from "../services/log.service.ts";
import { OtlpLogReceiverService } from "../services/otlp-log-receiver.service.ts";

export type LogInfrastructure = Readonly<{
  /** The process's one ClickHouse client, which routes each statement itself. */
  clickhouse: ClickHouseQueryClient;
}>;

type LogDependencies = Readonly<{ dataPrivacy: typeof DataPrivacyApi; traces: typeof TraceApi }>;
type LogSetup = FeatureSetup<LogDependencies, LogInfrastructure, LogServerConfig>;

/** The process-owned Log capability over private preparation, persistence and its pipeline. */
export class LogApp implements LogApiContract {
  static readonly contract = LogApi;
  static readonly config = logConfig;
  static readonly dependencies: LogDependencies = { dataPrivacy: DataPrivacyApi, traces: TraceApi };
  /** The run this module's durable processing needs, over ClickHouse only. */
  static readonly reads = ["clickhouse"] as const;

  readonly #service: LogService;
  readonly #pipeline: LogProcessingPipeline;
  readonly #receiver: OtlpLogReceiverService;
  #commands: EventingCommands<LogProcessingPipeline> | undefined;

  private constructor(
    service: LogService,
    pipeline: LogProcessingPipeline,
    receiver: OtlpLogReceiverService,
  ) {
    this.#service = service;
    this.#pipeline = pipeline;
    this.#receiver = receiver;
  }

  static create({ dependencies, members, config }: LogSetup): LogApp {
    const repository = ClickHouseCanonicalLogRecordRepository.create({
      resolveClient: createLogClickHouseResolver(members.clickhouse),
      defaultRetentionDays: LOG_DEFAULT_RETENTION_DAYS,
      defaultReadLimit: LOG_DEFAULT_READ_LIMIT,
    });
    const service = LogService.create({
      preparation: CanonicalLogService.create({ redaction: dependencies.dataPrivacy }),
      repository,
    });
    const pipeline = LogProcessingAdapter.create({
      repository,
      defaultRetentionDays: LOG_DEFAULT_RETENTION_DAYS,
      logCommandShardCount: CanonicalLogService.resolveLogCommandShardCount(
        config.processingShards,
      ),
    }).build();
    const app: LogApp = new LogApp(
      service,
      pipeline,
      OtlpLogReceiverService.create({
        traces: dependencies.traces,
        collection: LogRequestCollectionService.create({
          traces: dependencies.traces,
          logs: service,
          recordLogRecords: (records) => app.recordCanonicalLogRecords(records),
        }),
      }),
    );
    return app;
  }

  prepareCanonicalLogRecords(input: {
    tenantId: string;
    organizationId: string;
    request: unknown;
    piiRedactionLevel: LogPiiRedactionLevel;
    acceptedAt?: number;
  }): Promise<LogPreparation> {
    return this.#service.prepareCanonicalLogRecords(input);
  }

  receiveOtlpLogs(request: OtlpDoorRequest): Promise<LogOtlpDoorResult> {
    return this.#receiver.receive(request);
  }

  getLogsByTraceId(input: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<CanonicalTraceLogRecord[]> {
    return this.#service.getLogsByTraceId(input);
  }

  async recordCanonicalLogRecords(records: readonly CanonicalLogRecord[]): Promise<void> {
    if (records.length === 0) return;
    if (!this.#commands) {
      throw new Error("log_processing pipeline senders are not connected yet");
    }
    await this.#commands.recordLogRecord.sendBatch([...records]);
  }

  /** The pipeline this module registers, built once by {@link create}. */
  eventingPipeline(): LogProcessingPipeline {
    return this.#pipeline;
  }

  /** Binds the built pipeline's own senders; every write goes through them. */
  connectCommands(commands: EventingCommands<LogProcessingPipeline>): void {
    this.#commands = commands;
  }
}
