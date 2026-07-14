import {
  type ClickHouseClientResolver,
  getClickHouseClientForProject,
  isClickHouseEnabled,
} from "~/server/clickhouse/clickhouseClient";
import type { NormalizedLogRecord } from "~/server/event-sourcing/pipelines/trace-processing/schemas/logRecords";
import { LogRecordStorageClickHouseRepository } from "./repositories/log-record-storage.clickhouse.repository";
import {
  type LogRecordStorageRepository,
  NullLogRecordStorageRepository,
  type StoredLogRecordRow,
} from "./repositories/log-record-storage.repository";

export class LogRecordStorageService {
  constructor(readonly repository: LogRecordStorageRepository) {}

  async insertLogRecord(record: NormalizedLogRecord): Promise<void> {
    await this.repository.insertLogRecord(record);
  }

  /**
   * Read every log record correlated to one trace (generic across emitters),
   * oldest first, capped at `limit` rows (the repository's read cap unless the
   * caller narrows it). `occurredAtMs` is an optional partition-pruning hint
   * on the `TimeUnixMs` partition key. Powers the logs-read API (raw-log
   * inspector, dashboard frontend join) and the legacy read-path Claude Code
   * content enrichment.
   */
  async getLogsByTraceId(
    tenantId: string,
    traceId: string,
    occurredAtMs?: number,
    limit?: number,
  ): Promise<StoredLogRecordRow[]> {
    return this.repository.getLogsByTraceId(
      tenantId,
      traceId,
      occurredAtMs,
      limit,
    );
  }
}

/**
 * The default LogRecordStorageService for callers that don't inject one — a
 * ClickHouse-backed store when CH is enabled, else a no-op. Lives in the app
 * layer so the legacy `TraceService` can delegate its lazy default here instead
 * of constructing repositories (and touching CH config) itself.
 */
export function createDefaultLogRecordStorageService(): LogRecordStorageService {
  const resolveClickHouseClient: ClickHouseClientResolver = async (
    tenantId,
  ) => {
    const client = await getClickHouseClientForProject(tenantId);
    if (!client) {
      throw new Error(`ClickHouse not available for tenant ${tenantId}`);
    }
    return client;
  };
  return new LogRecordStorageService(
    isClickHouseEnabled()
      ? new LogRecordStorageClickHouseRepository(resolveClickHouseClient)
      : new NullLogRecordStorageRepository(),
  );
}
