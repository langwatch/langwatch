import { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EventingCommands } from "@langwatch/eventing";
import {
  LogApi,
  LOG_DEFAULT_RETENTION_DAYS,
  logConfig,
  type CanonicalLogRecord,
  type CanonicalTraceLogRecord,
  type LogApi as LogApiContract,
  type LogCollectionInput,
  type LogRequestCollectionResult,
  type LogPiiRedactionLevel,
  type LogOtlpDoorResult,
  type LogPreparation,
  type LogServerConfig,
} from "@langwatch/log-contract";
import type { OtlpDoorRequest } from "@langwatch/otlp";
import type { FeatureSetup } from "@langwatch/process";
import { TraceApi } from "@langwatch/trace-contract";

import { LogProcessingAdapter, type LogProcessingPipeline } from "../eventing/log.pipeline.ts";
import type { LogRepositories } from "../repositories/log.repositories.ts";
import { CanonicalLogService } from "../services/canonical-log.service.ts";
import { LogRequestCollectionService } from "../services/log-request-collection.service.ts";
import { LogService } from "../services/log.service.ts";
import { OtlpLogReceiverService } from "../services/otlp-log-receiver.service.ts";

type LogDependencies = Readonly<{
  dataPrivacy: typeof DataPrivacyApi;
  traces: typeof TraceApi;
  retention: typeof DataRetentionApi;
}>;
type LogSetup = FeatureSetup<LogDependencies, never, LogServerConfig, LogRepositories>;

/** The process-owned Log capability over private preparation, persistence and its pipeline. */
export class LogModule implements LogApiContract {
  static readonly contract = LogApi;
  static readonly config = logConfig;
  static readonly dependencies: LogDependencies = {
    dataPrivacy: DataPrivacyApi,
    traces: TraceApi,
    /** Each tenant's retention, which the log rows are stamped with. */
    retention: DataRetentionApi,
  };

  readonly #service: LogService;
  readonly #pipeline: LogProcessingPipeline;
  readonly #receiver: OtlpLogReceiverService;
  readonly #collection: LogRequestCollectionService;
  #commands: EventingCommands<LogProcessingPipeline> | undefined;

  private constructor(parts: {
    service: LogService;
    pipeline: LogProcessingPipeline;
    receiver: OtlpLogReceiverService;
    collection: LogRequestCollectionService;
  }) {
    this.#service = parts.service;
    this.#pipeline = parts.pipeline;
    this.#receiver = parts.receiver;
    this.#collection = parts.collection;
  }

  static create({ dependencies, repositories, config }: LogSetup): LogModule {
    const repository = repositories.logRecords;
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
      retention: {
        resolve: (tenantId) =>
          dependencies.retention.getResolvedForProject({ projectId: tenantId }),
      },
    }).build();
    const collection = LogRequestCollectionService.create({
      traces: dependencies.traces,
      logs: service,
      recordLogRecords: (records) => app.recordCanonicalLogRecords(records),
    });
    const app: LogModule = new LogModule({
      service,
      pipeline,
      receiver: OtlpLogReceiverService.create({ traces: dependencies.traces, collection }),
      collection,
    });
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

  collectOtlpLogs(input: LogCollectionInput): Promise<LogRequestCollectionResult> {
    return this.#collection.handleOtlpLogRequest(input);
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
