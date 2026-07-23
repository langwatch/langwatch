import { CanonicalLogRecordClickHouseRepository } from "~/server/app-layer/logs/repositories/canonical-log-record.clickhouse.repository";
import {
  type CanonicalLogRecordRepository,
  NullCanonicalLogRecordRepository,
} from "~/server/app-layer/logs/repositories/canonical-log-record.repository";
import {
  type ClickHouseClientResolver,
  getClickHouseClientForProject,
  isClickHouseEnabled,
} from "~/server/clickhouse/clickhouseClient";
import type { NormalizedLogRecord } from "~/server/event-sourcing/pipelines/trace-processing/schemas/logRecords";
import { LogRecordStorageClickHouseRepository } from "./repositories/log-record-storage.clickhouse.repository";
import {
  type LogRecordStorageRepository,
  mergeStoredLogRows,
  NullLogRecordStorageRepository,
  type StoredLogRecordRow,
} from "./repositories/log-record-storage.repository";

/**
 * The trace-correlated log READ, across the canonical cutover.
 *
 * Canonical `log_records` is the authoritative store; `stored_log_records`
 * still receives writes from pre-canonical instances during a rolling deploy
 * and holds every record ingested before the cutover, so a read that asked
 * only one table would silently lose whichever half the deployment timing
 * left in the other. Both are read, deduped on record identity, and merged
 * in time order — the same pattern the claude-marked read established.
 */
export class LogRecordStorageService {
  readonly repository: LogRecordStorageRepository;
  private readonly canonical: CanonicalLogRecordRepository;

  /**
   * `canonical` is REQUIRED: canonical `log_records` is the only table still
   * receiving writes, so a service built without it reads legacy-only and
   * silently returns nothing for every trace ingested after the cutover.
   * Deployments without ClickHouse pass NullCanonicalLogRecordRepository.
   */
  constructor({
    repository,
    canonical,
  }: {
    repository: LogRecordStorageRepository;
    canonical: CanonicalLogRecordRepository;
  }) {
    this.repository = repository;
    this.canonical = canonical;
  }

  async insertLogRecord(record: NormalizedLogRecord): Promise<void> {
    await this.repository.insertLogRecord(record);
  }

  /**
   * Read every log record correlated to one trace (generic across emitters),
   * oldest first, capped at `limit` rows (the repository's read cap unless the
   * caller narrows it). `occurredAtMs` is an optional partition-pruning hint
   * on the `TimeUnixMs` partition key. Powers the logs-read API (raw-log
   * inspector, drawer log accordions, the coding-agent transcript) and the
   * read-path Claude Code content enrichment.
   */
  async getLogsByTraceId(
    tenantId: string,
    traceId: string,
    occurredAtMs?: number,
    limit?: number,
  ): Promise<StoredLogRecordRow[]> {
    const [legacy, canonical] = await Promise.all([
      this.repository.getLogsByTraceId(tenantId, traceId, occurredAtMs, limit),
      this.canonical.getLogsByTraceId({
        tenantId,
        traceId,
        occurredAtMs,
        limit,
      }),
    ]);
    // Keep-last dedup: canonical goes LAST so it wins a divergent duplicate,
    // matching "canonical is the authoritative store".
    return mergeStoredLogRows([...legacy, ...canonical], limit);
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
  return isClickHouseEnabled()
    ? new LogRecordStorageService({
        repository: new LogRecordStorageClickHouseRepository(
          resolveClickHouseClient,
        ),
        canonical: new CanonicalLogRecordClickHouseRepository(
          resolveClickHouseClient,
        ),
      })
    : new LogRecordStorageService({
        repository: new NullLogRecordStorageRepository(),
        canonical: new NullCanonicalLogRecordRepository(),
      });
}
