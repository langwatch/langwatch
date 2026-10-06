import { PRODUCTION_STORAGE_METER_TABLES } from "@langwatch/data-retention-contract/retention-tables";

import type { StorageMeterRepository, StorageMeterTable } from "../storage-meter.repository.ts";

/** The memory tier's meter: bytes a test records per tenant and table, zero where none were. */
export class MemoryStorageMeterRepository implements StorageMeterRepository {
  static create(): MemoryStorageMeterRepository {
    return new MemoryStorageMeterRepository();
  }

  readonly #bytes = new Map<string, number>();

  private constructor() {}

  /** Records what one table holds for a tenant, as a write to that table would. */
  record(input: { tenantId: string; table: StorageMeterTable; bytes: number }): void {
    this.#bytes.set(keyOf(input), input.bytes);
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
