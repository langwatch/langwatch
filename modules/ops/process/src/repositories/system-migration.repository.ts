import type { SystemMigrationStateRepository as RunnerStateRepository } from "@langwatch/system-migrations";

import type {
  SystemMigrationEnrollmentStore,
  SystemMigrationStateReader,
} from "../rules/system-migration-support.rules.ts";

/** Which organizations each migration processes: the console's store plus the pass's one read. */
export interface SystemMigrationEnrollmentRepository extends SystemMigrationEnrollmentStore {
  /** Every enrollment as migration name to organization ids, read once per pass. */
  findEnrolledOrganizationIdsByMigration(): Promise<Map<string, Set<string>>>;
}

/** The per-(migration, tenant) ledger: the runner's port, the console's reads, the re-drive. */
export interface SystemMigrationStateRepository
  extends RunnerStateRepository, SystemMigrationStateReader {
  /** Whether a later pass could still move a tenant (`parked`, `migrated`) in these migrations. */
  hasTenantAwaitingRedrive(args: { migrationNames: readonly string[] }): Promise<boolean>;
}
