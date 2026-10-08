import type { CanonicalLogRecord } from "@langwatch/log-contract";

import { CanonicalLogRecordRepository } from "../canonical-log-record.repository.ts";
import {
  ClickHouseCanonicalLogRecordAppendRepository,
  type LogClickHouseClientResolver,
} from "./clickhouse.canonical-log-record-append.repository.ts";

/** Canonical-log over ClickHouse: the append delegated, shared with log_processing. */
export class ClickHouseCanonicalLogRecordRepository extends CanonicalLogRecordRepository {
  private readonly append: ClickHouseCanonicalLogRecordAppendRepository;

  private constructor(resolveClient: LogClickHouseClientResolver, defaultRetentionDays: number) {
    super();
    this.append = ClickHouseCanonicalLogRecordAppendRepository.create({
      resolveClient,
      defaultRetentionDays,
    });
  }

  static create(options: {
    resolveClient: LogClickHouseClientResolver;
    defaultRetentionDays: number;
  }): ClickHouseCanonicalLogRecordRepository {
    return new ClickHouseCanonicalLogRecordRepository(
      options.resolveClient,
      options.defaultRetentionDays,
    );
  }

  async ensureLogRecord(record: CanonicalLogRecord, retentionDays?: number): Promise<void> {
    await this.append.ensureLogRecord(record, retentionDays);
  }

  async ensureLogRecords(records: CanonicalLogRecord[], retentionDays?: number): Promise<void> {
    await this.append.ensureLogRecords(records, retentionDays);
  }
}
