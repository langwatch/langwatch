import { PRODUCTION_STORAGE_METER_TABLES } from "@langwatch/data-retention-contract/retention-tables";

import type { StorageMeterRepository, StorageMeterTable } from "../storage-meter.repository.ts";

/** The memory tier's meter: bytes a test records per tenant and table, zero where none were. */
export class MemoryStorageMeterRepository implements StorageMeterRepository {
  static create(): MemoryStorageMeterRepository {
    return new MemoryStorageMeterRepository();
  }

  readonly #bytes = new Map<string, number>();
  readonly #dated: { tenantId: string; bytes: number; atMs: number }[] = [];

  private constructor() {}

  /** Records what one table holds for a tenant, as a write to that table would. */
  record(input: { tenantId: string; table: StorageMeterTable; bytes: number }): void {
    this.#bytes.set(keyOf(input), input.bytes);
  }

  /** Records bytes a tenant wrote at one time, for reads that filter by row time. */
  recordAt(input: { tenantId: string; bytes: number; atMs: number }): void {
    this.#dated.push({ ...input });
  }

  async getTenantBytesBefore({
    tenantId,
    beforeMs,
  }: {
    tenantId: string;
    beforeMs: number;
  }): Promise<number> {
    return this.#dated
      .filter((row) => row.tenantId === tenantId && row.atMs < beforeMs)
      .reduce((sum, row) => sum + row.bytes, 0);
  }

  async getTenantBytes({ tenantId }: { tenantId: string }): Promise<number> {
    return PRODUCTION_STORAGE_METER_TABLES.reduce(
      (sum, table) => sum + (this.#bytes.get(keyOf({ tenantId, table })) ?? 0),
      0,
    );
  }

  async getTableBytes(input: { tenantId: string; table: StorageMeterTable }): Promise<number> {
    return this.#bytes.get(keyOf(input)) ?? 0;
  }
}

function keyOf({ tenantId, table }: { tenantId: string; table: string }): string {
  return `${tenantId}\u0000${table}`;
}
