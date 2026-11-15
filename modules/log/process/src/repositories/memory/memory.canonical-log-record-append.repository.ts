import type { CanonicalLogRecord } from "@langwatch/log-contract";

import { CanonicalLogRecordAppendRepository } from "../canonical-log-record-append.repository.ts";

/** Canonical logs held in memory: one row per tenant and record id, newest acceptance wins. */
export class MemoryCanonicalLogRecordAppendRepository extends CanonicalLogRecordAppendRepository {
  readonly #records = new Map<string, CanonicalLogRecord>();

  private constructor() {
    super();
  }

  static create(): MemoryCanonicalLogRecordAppendRepository {
    return new MemoryCanonicalLogRecordAppendRepository();
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

  /** The tenant's held records' JSON byte length, standing in for `_size_bytes`. */
  async getStoredBytes({ tenantId }: { tenantId: string }): Promise<number> {
    let total = 0;
    for (const record of this.#records.values()) {
      if (record.tenantId === tenantId) total += Buffer.byteLength(JSON.stringify(record));
    }
    return total;
  }
}
