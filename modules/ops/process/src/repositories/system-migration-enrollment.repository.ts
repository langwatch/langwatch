import type { SystemMigrationEnrollmentStore } from "../rules/system-migration-support.rules.ts";

/** Which organizations each migration processes: the console's store plus the pass's one read. */
export interface SystemMigrationEnrollmentRepository extends SystemMigrationEnrollmentStore {
  /** Every enrollment as migration name to organization ids, read once per pass. */
  findEnrolledOrganizationIdsByMigration(): Promise<Map<string, Set<string>>>;
}
