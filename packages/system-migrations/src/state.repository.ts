import type { TenantMigrationRecord } from "./types.ts";

/**
 * Stored migration state, one record per (migration, tenant). The app
 * implements this with Prisma; tests use an in-memory fake. Methods return
 * stored facts - the state machine's rules live in the runner.
 */
export interface SystemMigrationStateRepository {
  tryFindRecord(args: {
    migrationName: string;
    tenantId: string;
  }): Promise<TenantMigrationRecord | null>;

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
