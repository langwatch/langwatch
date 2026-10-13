import {
  LogRecordStorageRepository,
  type StoredLogRecordRow,
  TRACE_LOG_READ_CAP,
} from "../log-record-storage.repository.ts";

/** A row as a test seeds it, with the tenant that owns it. */
type SeededLogRecord = StoredLogRecordRow & { tenantId: string };

function readTrace({
  rows,
  tenantId,
  traceId,
  limit,
}: {
  rows: readonly SeededLogRecord[];
  tenantId: string;
  traceId: string;
  limit: number;
}): StoredLogRecordRow[] {
  return rows
    .filter((row) => row.tenantId === tenantId && row.traceId === traceId)
    .toSorted((left, right) => left.timeUnixMs - right.timeUnixMs)
    .slice(0, limit)
    .map(({ tenantId: _tenantId, ...row }) => row);
}

/** In-memory legacy `stored_log_records` and log's shared `log_records`, seeded by a test. */
export class MemoryLogRecordStorageRepository extends LogRecordStorageRepository {
  static create({
    storedLogRecords = [],
    logRecords = [],
  }: {
    storedLogRecords?: readonly SeededLogRecord[];
    logRecords?: readonly SeededLogRecord[];
  } = {}): MemoryLogRecordStorageRepository {
    return new MemoryLogRecordStorageRepository(storedLogRecords, logRecords);
  }

  private constructor(
    private readonly storedLogRecords: readonly SeededLogRecord[],
    private readonly logRecords: readonly SeededLogRecord[],
  ) {
    super();
  }

  async findLogsByTraceId({
    tenantId,
    traceId,
    limit = TRACE_LOG_READ_CAP,
  }: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<StoredLogRecordRow[]> {
    return readTrace({ rows: this.storedLogRecords, tenantId, traceId, limit });
  }

  async findLogRecordsByTraceId({
    tenantId,
    traceId,
    limit = TRACE_LOG_READ_CAP,
  }: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<StoredLogRecordRow[]> {
    return readTrace({ rows: this.logRecords, tenantId, traceId, limit });
  }
}
