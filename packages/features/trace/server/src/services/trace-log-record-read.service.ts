import type { LogService } from "@langwatch/log-contract";
import {
  LogRecordStorageRepository,
  type StoredLogRecordRow,
} from "../repositories/log-record-storage.repository";

/**
 * The trace-correlated log READ, across the canonical cutover. Canonical `log_records` is authoritative; `stored_log_records` still receives writes from pre-canonical instances during a rolling deploy and holds every record ingested before the cutover, so a read that asked only one table would silently lose whichever half deployment timing left in the other. Both are read, deduped on record identity, and merged in time order — the same pattern the claude-marked read established.
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
   * `canonical` is REQUIRED: canonical `log_records` is the only table still receiving writes, so a service built without it reads legacy-only and silently returns nothing for every trace ingested after the cutover. Deployments without ClickHouse receive the unavailable Log service adapter.
   */
  constructor({
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
   * Read every log record correlated to one trace (generic across emitters), oldest first, capped at `limit` rows. `occurredAtMs` is an optional partition-pruning hint on the `TimeUnixMs` partition key. Powers the logs-read API (raw-log inspector, drawer log accordions, the coding-agent transcript) and the read-path Claude Code content enrichment.
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
