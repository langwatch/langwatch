import type { TenantMigrationRecord } from "./types";

/**
 * Stored migration state, one record per (migration, tenant). The app
 * implements this with Prisma; tests use an in-memory fake. Methods return
 * stored facts - the state machine's rules live in the runner.
 */
export interface SystemMigrationStateRepository {
  findRecord(args: {
    migrationName: string;
    tenantId: string;
  }): Promise<TenantMigrationRecord | null>;

  upsertRecord(record: TenantMigrationRecord): Promise<void>;

  /**
   * The runner's outcome write: land the record UNLESS an operator has
   * pinned the row `rolled_back` since the pass read it.
   *
   * `upsertRecord` is last-writer-wins, and the runner's passes are long: a
   * tenant read as `migrated` at the top of `migrateTenant` can be pinned
   * `rolled_back` by an operator while the work runs, and an unconditional
   * outcome write minutes later would silently overwrite that pin - the
   * next pass then re-finalizes a tenant a human just pulled off the
   * ledger. So the runner writes through this compare-and-set instead:
   * implementations must make the status check and the write atomic (a
   * guarded UPDATE, or a read-check inside the same transaction), and
   * answer `false` - written nothing - when the stored row says
   * `rolled_back`. The runner treats `false` as the pin winning: terminal
   * for that tenant this pass.
   */
  upsertRecordUnlessRolledBack(record: TenantMigrationRecord): Promise<boolean>;
}
