import type { ProcessStore } from "@langwatch/eventing";
import type { MigrationLeaseRepository } from "@langwatch/system-migrations";

import type { BugReportRepository } from "./bug-report.repository.ts";
import type { MigrationMembershipRepository } from "./migration-membership.repository.ts";
import type { OrganizationTenantSourceRepository } from "./organization-tenant-source.repository.ts";
import type { ProcessManagerPurgeRepository } from "./process-manager-purge.repository.ts";
import type { ProjectTenantSourceRepository } from "./project-tenant-source.repository.ts";
import type { SystemMigrationEnrollmentRepository } from "./system-migration-enrollment.repository.ts";
import type { SystemMigrationStateRepository } from "./system-migration-state.repository.ts";
import type {
  OrganizationMemberTenantSourceRepository,
  UserTenantSourceRepository,
} from "./user-tenant-source.repository.ts";

/**
 * The rows this module owns in the platform's own database (the support inbox and the system
 * migration ledger and enrollment), the process-manager store the manager explorer reads, the
 * migration pass's tenant walks and its lease in Redis.
 */
export interface OpsRepositories {
  readonly bugReports: BugReportRepository;
  readonly processStore: ProcessStore;
  /** The outbox and inbox retention purge only the process-manager-purge task runs. */
  readonly processManagerPurge: ProcessManagerPurgeRepository;
  readonly migrationState: SystemMigrationStateRepository;
  readonly migrationEnrollments: SystemMigrationEnrollmentRepository;
  readonly migrationMemberships: MigrationMembershipRepository;
  readonly migrationLease: MigrationLeaseRepository;
  readonly organizationTenants: OrganizationTenantSourceRepository;
  readonly projectTenants: ProjectTenantSourceRepository;
  readonly userTenants: UserTenantSourceRepository;
  readonly organizationMemberTenants: OrganizationMemberTenantSourceRepository;
}
