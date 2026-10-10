import {
  SystemMigrationRecordNotFoundError,
  type SystemMigrationStateRepository,
  type TenantMigrationRecord,
} from "@langwatch/system-migrations";

import type { TenantStepLedger } from "./tenant-step-settle.service.ts";

/** The tenant step state table's twin, for tests and the memory tier. */
export class MemoryTenantStepStateRepository implements SystemMigrationStateRepository {
  private readonly records = new Map<string, TenantMigrationRecord>();

  static create(): MemoryTenantStepStateRepository {
    return new MemoryTenantStepStateRepository();
  }

  private constructor() {}

  async getRecord({
    migrationName,
    tenantId,
  }: {
    migrationName: string;
    tenantId: string;
  }): Promise<TenantMigrationRecord> {
    const record = this.records.get(keyOf({ migrationName, tenantId }));
    if (!record) throw new SystemMigrationRecordNotFoundError({ migrationName, tenantId });
    return record;
  }

  async upsertRecord(record: TenantMigrationRecord): Promise<void> {
    this.records.set(keyOf(record), record);
  }

  async upsertRecordUnlessRolledBack(record: TenantMigrationRecord): Promise<boolean> {
    if (this.records.get(keyOf(record))?.status === "rolled_back") return false;
    this.records.set(keyOf(record), record);
    return true;
  }

  async hasFinalizedTenant({ migrationName }: { migrationName: string }): Promise<boolean> {
    return [...this.records.values()].some(
      (record) => record.migrationName === migrationName && record.status === "finalized",
    );
  }

  async hasUnsettledTenant({ migrationName }: { migrationName: string }): Promise<boolean> {
    return [...this.records.values()].some(
      (record) =>
        record.migrationName === migrationName &&
        (record.status === "parked" || record.heldReason !== undefined),
    );
  }
}

function keyOf({ migrationName, tenantId }: { migrationName: string; tenantId: string }): string {
  return JSON.stringify([migrationName, tenantId]);
}

/** The ledger's tenant step rows' twin, for tests and the memory tier: settled or not, by id. */
export class MemoryTenantStepLedgerRepository implements TenantStepLedger {
  private readonly rows = new Map<string, boolean>();

  static create(): MemoryTenantStepLedgerRepository {
    return new MemoryTenantStepLedgerRepository();
  }

  private constructor() {}

  async settleTenantStep({ id, settled }: { id: string; settled: boolean }): Promise<void> {
    this.rows.set(id, settled);
  }

  /** Whether the last settle found the step settled; false when it was never settled. */
  isSettled({ id }: { id: string }): boolean {
    return this.rows.get(id) === true;
  }
}
