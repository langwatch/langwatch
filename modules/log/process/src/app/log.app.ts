import { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import {
  LogApi,
  LOG_DEFAULT_READ_LIMIT,
  LOG_DEFAULT_RETENTION_DAYS,
  logConfig,
  type CanonicalTraceLogRecord,
  type LogApi as LogApiContract,
  type LogPiiRedactionLevel,
  type LogPreparation,
  type LogServerConfig,
} from "@langwatch/log-contract";

import type { LogClickHouseClientResolver } from "../repositories/clickhouse/clickhouse.canonical-log-record-append.repository.ts";
import { ClickHouseCanonicalLogRecordRepository } from "../repositories/clickhouse/clickhouse.canonical-log-record.repository.ts";
import { NullCanonicalLogRecordRepository } from "../repositories/null/null.canonical-log-record.repository.ts";
import { CanonicalLogAdapter } from "../services/canonical-log.service.ts";
import { LogService } from "../services/log.service.ts";

export type LogInfrastructure = Readonly<{
  resolveClient: LogClickHouseClientResolver | null;
}>;

type LogDependencies = Readonly<{ dataPrivacy: typeof DataPrivacyApi }>;
type LogSetup = FeatureSetup<LogDependencies, LogInfrastructure, LogServerConfig>;

/** The process-owned Log capability over private preparation and persistence services. */
export class LogApp implements LogApiContract {
  static readonly contract = LogApi;
  static readonly config = logConfig;
  static readonly dependencies: LogDependencies = { dataPrivacy: DataPrivacyApi };

  readonly #service: LogService;

  private constructor(service: LogService) {
    this.#service = service;
  }

  static create({ dependencies, members }: LogSetup): LogApp {
    const repository = members.resolveClient
      ? ClickHouseCanonicalLogRecordRepository.create({
          resolveClient: members.resolveClient,
          defaultRetentionDays: LOG_DEFAULT_RETENTION_DAYS,
          defaultReadLimit: LOG_DEFAULT_READ_LIMIT,
        })
      : NullCanonicalLogRecordRepository.create();
    const service = LogService.create({
      preparation: CanonicalLogAdapter.create({ redaction: dependencies.dataPrivacy }),
      repository,
    });
    return new LogApp(service);
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
}
