import type { TenantMigrationRecord } from "@langwatch/system-migrations";

/**
 * The two migration-state reads the per-user write fork is decided from.
 *
 * A port rather than the state repository itself: the gate asks two questions
 * of one row family, the runtime composes whichever store answers them, and
 * nothing here needs the runner's writes.
 */
export abstract class IdentityWriteGateStatePort {
  /** One tenant's record for a migration, or null when it has none. */
  abstract findRecord(input: {
    migrationName: string;
    tenantId: string;
  }): Promise<TenantMigrationRecord | null>;

  /** Whether ANY tenant has finalized this migration. */
  abstract hasFinalizedTenant(input: { migrationName: string }): Promise<boolean>;
}
