import type { CanonicalLogRecord } from "@langwatch/log-contract";

import { CanonicalLogRecordRepository } from "../canonical-log-record.repository.ts";

/** Canonical logs held in memory: one row per tenant and record id, newest acceptance wins. */
export class MemoryCanonicalLogRecordRepository extends CanonicalLogRecordRepository {
  readonly #records = new Map<string, CanonicalLogRecord>();

  private constructor() {
    super();
  }

  static create(): MemoryCanonicalLogRecordRepository {
    return new MemoryCanonicalLogRecordRepository();
  }

  /** Every record held, one per tenant and record id. */
  records(): readonly CanonicalLogRecord[] {
    return [...this.#records.values()];
  }

  async ensureLogRecord(record: CanonicalLogRecord): Promise<void> {
    const key = `${record.tenantId}:${record.recordId}`;
    const existing = this.#records.get(key);
    if (existing && existing.acceptedAt > record.acceptedAt) return;
    this.#records.set(key, record);
  }

  async ensureLogRecords(records: CanonicalLogRecord[]): Promise<void> {
    for (const record of records) await this.ensureLogRecord(record);
  }
}
