import { InMemoryProcessStore } from "@langwatch/eventing";

import type { OpsRepositories } from "../ops.repositories.ts";
import { MemoryBugReportRepository } from "./memory.bug-report.repository.ts";
import { MemoryMigrationLeaseRepository } from "./memory.migration-lease.repository.ts";
import { MemoryMigrationMembershipRepository } from "./memory.migration-membership.repository.ts";
import { MemoryOpsStore } from "./memory.ops.store.ts";
import { MemoryOrganizationTenantSourceRepository } from "./memory.organization-tenant-source.repository.ts";
import { MemoryProcessManagerPurgeRepository } from "./memory.process-manager-purge.repository.ts";
import { MemoryProjectTenantSourceRepository } from "./memory.project-tenant-source.repository.ts";
import { MemorySystemMigrationEnrollmentRepository } from "./memory.system-migration-enrollment.repository.ts";
import { MemorySystemMigrationStateRepository } from "./memory.system-migration-state.repository.ts";
import {
  MemoryOrganizationMemberTenantSourceRepository,
  MemoryUserTenantSourceRepository,
} from "./memory.user-tenant-source.repository.ts";

/**
 * One store per composed process, shared by every twin, so a row one
 * repository writes is a row the next one reads.
 */
export class MemoryOpsRepositories {
  static readonly requires = [] as const;

  static create(): OpsRepositories {
    const store = MemoryOpsStore.create();

    return {
      bugReports: MemoryBugReportRepository.create({ store }),
      processStore: InMemoryProcessStore.createForLocalDevelopment(),
      processManagerPurge: MemoryProcessManagerPurgeRepository.create(),
      migrationState: MemorySystemMigrationStateRepository.create(),
      migrationEnrollments: MemorySystemMigrationEnrollmentRepository.create(),
      migrationMemberships: MemoryMigrationMembershipRepository.create(),
      migrationLease: MemoryMigrationLeaseRepository.create(),
      organizationTenants: MemoryOrganizationTenantSourceRepository.create(),
      projectTenants: MemoryProjectTenantSourceRepository.create(),
      userTenants: MemoryUserTenantSourceRepository.create(),
      organizationMemberTenants: MemoryOrganizationMemberTenantSourceRepository.create(),
    };
  }
}
