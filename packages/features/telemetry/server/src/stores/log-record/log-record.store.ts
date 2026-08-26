import type {
  AppendStore,
  BulkAppendContext,
  ProjectionStoreContext,
} from "@langwatch/eventing";
import type { CanonicalLogRecordAppendPort } from "../../ports/telemetry-repositories.port";
import type { CanonicalLogRecord } from "@langwatch/telemetry-contract";

export class CanonicalLogAppendStore implements AppendStore<CanonicalLogRecord> {
  static create(
    repository: CanonicalLogRecordAppendPort,
    defaultRetentionDays: number,
  ): CanonicalLogAppendStore {
    return new CanonicalLogAppendStore(repository, defaultRetentionDays);
  }

  constructor(
    private readonly repository: CanonicalLogRecordAppendPort,
    private readonly defaultRetentionDays: number,
  ) {}

  async append(
    record: CanonicalLogRecord,
    context: ProjectionStoreContext,
  ): Promise<void> {
    await this.repository.ensureLogRecord(
      record,
      context.retentionPolicy?.traces ?? this.defaultRetentionDays,
    );
  }

  async bulkAppend(
    records: CanonicalLogRecord[],
    context: BulkAppendContext,
  ): Promise<void> {
    if (records.length === 0) return;
    await this.repository.ensureLogRecords(
      records,
      context.retentionPolicy?.traces ?? this.defaultRetentionDays,
    );
  }
}
