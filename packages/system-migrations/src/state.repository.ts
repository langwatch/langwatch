import type { TenantMigrationRecord } from "./types.ts";

/** No record is stored for this (migration, tenant): the tenant has not been visited yet. */
export class SystemMigrationRecordNotFoundError extends Error {
  constructor({ migrationName, tenantId }: { migrationName: string; tenantId: string }) {
    super(`No system migration record for ${migrationName} on tenant ${tenantId}`);
    this.name = "SystemMigrationRecordNotFoundError";
  }
}

/**
 * Stored migration state, one record per (migration, tenant): stored facts only,
 * the state machine's rules live in the runner.
 */
export interface SystemMigrationStateRepository {
  /** Throws `SystemMigrationRecordNotFoundError` when the tenant has no record. */
  getRecord(args: { migrationName: string; tenantId: string }): Promise<TenantMigrationRecord>;

  upsertRecord(record: TenantMigrationRecord): Promise<void>;

  /**
   * Compare-and-set outcome write: updates unless the row is `rolled_back`.
   * Must be atomic. Returns false if the stored row says `rolled_back`.
   */
  upsertRecordUnlessRolledBack(record: TenantMigrationRecord): Promise<boolean>;

  /**
   * Has ANY tenant finished this migration? While no, the per-tenant read is
   * pure cost, so a per-tenant gate asks this first - one cached read per pod
   * replacing one per tenant, self-disabling once the first tenant finishes.
   */
  hasFinalizedTenant(args: { migrationName: string }): Promise<boolean>;
}
