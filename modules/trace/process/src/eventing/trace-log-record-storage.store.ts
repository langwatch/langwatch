import type { AppendStore, BulkAppendContext, ProjectionStoreContext } from "@langwatch/eventing";

import type {
  LogRecordStorageRepository,
  StoredLogRecordWrite,
} from "../repositories/log-record-storage.repository.ts";

/** AppendStore over `stored_log_records`: stamps the tenant's trace retention on each row. */
export class TraceLogRecordStorageStore implements AppendStore<StoredLogRecordWrite> {
  private constructor(
    private readonly storage: LogRecordStorageRepository,
    private readonly defaultRetentionDays: () => number,
  ) {}

  static create(options: {
    storage: LogRecordStorageRepository;
    defaultRetentionDays: () => number;
  }): TraceLogRecordStorageStore {
    return new TraceLogRecordStorageStore(options.storage, options.defaultRetentionDays);
  }

  async append(record: StoredLogRecordWrite, context: ProjectionStoreContext): Promise<void> {
    const retentionDays = context.retentionPolicy?.traces ?? this.defaultRetentionDays();
    await this.storage.insertLogRecords({ records: [record], retentionDays });
  }

  async bulkAppend(records: StoredLogRecordWrite[], context: BulkAppendContext): Promise<void> {
    if (records.length === 0) return;
    const retentionDays = context.retentionPolicy?.traces ?? this.defaultRetentionDays();
    await this.storage.insertLogRecords({ records, retentionDays });
  }
}
