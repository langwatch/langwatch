import {
  SystemMigrationRecordNotFoundError,
  type SystemMigrationStateRepository,
  type TenantMigrationRecord,
} from "@langwatch/system-migrations";

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
}

function keyOf({ migrationName, tenantId }: { migrationName: string; tenantId: string }): string {
  return JSON.stringify([migrationName, tenantId]);
}
