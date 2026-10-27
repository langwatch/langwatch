import type { OpsMigrationOverview } from "@langwatch/ops-contract";
import type {
  SystemMigrationStateRepository as RunnerStateRepository,
  TenantMigrationStatus,
} from "@langwatch/system-migrations";

import type { SystemMigrationEnrollmentStore } from "../rules/system-migration-support.rules.ts";

/** Which organizations each migration processes: the console's store plus the pass's one read. */
export interface SystemMigrationEnrollmentRepository extends SystemMigrationEnrollmentStore {
  /** Every enrollment as migration name to organization ids, read once per pass. */
  findEnrolledOrganizationIdsByMigration(): Promise<Map<string, Set<string>>>;
}

/**
 * The per-(migration, tenant) table ops held before its migrations moved to their owners' steps:
 * the copy steps read it, and authz and identity still read their older rows there.
 */
export interface SystemMigrationStateRepository extends RunnerStateRepository {
  findStatusCounts(args: { migrationName: string }): Promise<Record<TenantMigrationStatus, number>>;
  /** Newest movement first; no `migrationName` reads every migration's rows. */
  findRecordsByStatus(args: {
    migrationName?: string | undefined;
    statuses: TenantMigrationStatus[];
    limit: number;
    offset?: number;
  }): Promise<OpsMigrationOverview["attention"]>;
  /** Whether a later pass could still move a tenant (`parked`, `migrated`) in these migrations. */
  hasTenantAwaitingRedrive(args: { migrationNames: readonly string[] }): Promise<boolean>;
}
