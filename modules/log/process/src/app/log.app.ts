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
  type LogPreparation,
  type LogServerConfig,
} from "@langwatch/log-contract";

import type { LogProcessingPipeline } from "../eventing/log.pipeline.ts";
import { createLogClickHouseResolver } from "../repositories/clickhouse/clickhouse.canonical-log-record-append.repository.ts";
import { ClickhouseLogRepository } from "../repositories/clickhouse/clickhouse.log.repository.ts";
import { CanonicalLogAdapter } from "../services/canonical-log.service.ts";
import type { LogService } from "../services/log.service.ts";

export type LogInfrastructure = Readonly<{
  /** The process's one ClickHouse client, which routes each statement itself. */
  clickhouse: ClickHouseQueryClient;
}>;

type LogDependencies = Readonly<{ dataPrivacy: typeof DataPrivacyApi }>;
type LogSetup = FeatureSetup<LogDependencies, LogInfrastructure, LogServerConfig>;

/** The process-owned Log capability over private preparation, persistence and its pipeline. */
export class LogApp implements LogApiContract {
  static readonly contract = LogApi;
  static readonly config = logConfig;
  static readonly dependencies: LogDependencies = { dataPrivacy: DataPrivacyApi };
  /** The run this module's durable processing needs, over ClickHouse only. */
  static readonly reads = ["clickhouse"] as const;

  readonly #service: LogService;
  readonly #pipeline: LogProcessingPipeline;
  #commands: EventingCommands<LogProcessingPipeline> | undefined;

  private constructor(service: LogService, pipeline: LogProcessingPipeline) {
    this.#service = service;
    this.#pipeline = pipeline;
  }

  static create({ dependencies, members, config }: LogSetup): LogApp {
    const composition = ClickhouseLogRepository.create({
      resolveClient: createLogClickHouseResolver(members.clickhouse),
      defaultRetentionDays: LOG_DEFAULT_RETENTION_DAYS,
      defaultReadLimit: LOG_DEFAULT_READ_LIMIT,
      logCommandShardCount: CanonicalLogAdapter.resolveLogCommandShardCount(config.processingShards),
      redaction: dependencies.dataPrivacy,
    });
    return new LogApp(composition.getService(), composition.buildProcessing());
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
