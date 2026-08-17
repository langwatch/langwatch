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
}
