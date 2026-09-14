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
   * Has ANY tenant finished this migration? The question a per-tenant gate
   * asks before it asks its own: while the answer is no, no tenant can be
   * past the gate, so the per-tenant read is pure cost. One cached read per
   * pod then replaces one cached read per tenant, and it self-disables the
   * moment an operator enrols the first one.
   */
  hasFinalizedTenant(args: { migrationName: string }): Promise<boolean>;
}
