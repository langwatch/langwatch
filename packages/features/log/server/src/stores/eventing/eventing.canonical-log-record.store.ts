import type { AppendStore, BulkAppendContext, ProjectionStoreContext } from "@langwatch/eventing";
import type { CanonicalLogRecord } from "@langwatch/log-contract";
import type { CanonicalLogRecordRepository } from "../../repositories/canonical-log-record.repository";

export class CanonicalLogRecordStore implements AppendStore<CanonicalLogRecord> {
  private constructor(
    private readonly repository: CanonicalLogRecordRepository,
    private readonly defaultRetentionDays: number,
  ) {}

  static create(
    repository: CanonicalLogRecordRepository,
    defaultRetentionDays: number,
  ): CanonicalLogRecordStore {
    return new CanonicalLogRecordStore(repository, defaultRetentionDays);
  }

  async append(record: CanonicalLogRecord, context: ProjectionStoreContext): Promise<void> {
    await this.repository.ensureLogRecord(
      record,
      context.retentionPolicy?.traces ?? this.defaultRetentionDays,
    );
  }

  async bulkAppend(records: CanonicalLogRecord[], context: BulkAppendContext): Promise<void> {
    if (records.length === 0) return;
    await this.repository.ensureLogRecords(
      records,
      context.retentionPolicy?.traces ?? this.defaultRetentionDays,
    );
  }
}
