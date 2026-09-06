import type { LogService } from "@langwatch/log-contract";
import {
  LogRecordStorageRepository,
  type StoredLogRecordRow,
} from "../repositories/log-record-storage.repository.ts";

/**
 * The trace-correlated log read, across the canonical cutover. Canonical `log_records` is
 * authoritative; `stored_log_records` still takes writes during a rolling deploy and holds every
 * pre-cutover record. Both are read, deduped on record identity, and merged in time order.
 */
export class LogRecordStorageService {
  static create(options: {
    repository: LogRecordStorageRepository;
    canonical: LogService;
  }): LogRecordStorageService {
    return new LogRecordStorageService(options);
  }

  readonly repository: LogRecordStorageRepository;
  private readonly canonical: LogService;

  /**
   * `canonical` is required: canonical `log_records` is the only table still receiving writes, so
   * a service built without it reads legacy-only and silently returns nothing for every trace
   * ingested after the cutover. Deployments without ClickHouse get the unavailable Log adapter.
   */
  private constructor({
    repository,
    canonical,
  }: {
    repository: LogRecordStorageRepository;
    canonical: LogService;
  }) {
    this.repository = repository;
    this.canonical = canonical;
  }

  /**
   * Every log record correlated to one trace, oldest first, capped at `limit` rows. `occurredAtMs`
   * is an optional partition-pruning hint on the `TimeUnixMs` partition key. Powers the logs-read
   * API and the read-path Claude Code content enrichment.
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
    return LogRecordStorageRepository.mergeStoredLogRows([...legacy, ...canonical], limit);
  }
}
