import { PrismaProcessStore } from "@langwatch/eventing/server";
import { prismaRepositories } from "@langwatch/prisma-client";

import type { OpsRepositories } from "../ops.repositories.ts";
import { PrismaBugReportRepository } from "./prisma.bug-report.repository.ts";
import { PrismaMigrationMembershipRepository } from "./prisma.migration-membership.repository.ts";
import { PrismaOrganizationTenantSourceRepository } from "./prisma.organization-tenant-source.repository.ts";
import { PrismaProcessManagerPurgeRepository } from "./prisma.process-manager-purge.repository.ts";
import { PrismaProjectTenantSourceRepository } from "./prisma.project-tenant-source.repository.ts";
import { PrismaSystemMigrationEnrollmentRepository } from "./prisma.system-migration-enrollment.repository.ts";
import { PrismaSystemMigrationStateRepository } from "./prisma.system-migration-state.repository.ts";
import {
  PrismaOrganizationMemberTenantSourceRepository,
  PrismaUserTenantSourceRepository,
} from "./prisma.user-tenant-source.repository.ts";

const claimedOpsRepositories = prismaRepositories({
  bugReports: PrismaBugReportRepository,
});

/** The claimed rows, eventing's own process store and the migration pass's Postgres reads. */
export const PostgresOpsRepositories = {
  ...claimedOpsRepositories,
  create: (
    members: Parameters<typeof claimedOpsRepositories.create>[0],
  ): Omit<OpsRepositories, "migrationLease"> => {
    const { prisma } = members;
    return {
      ...claimedOpsRepositories.create(members),
      processStore: PrismaProcessStore.create({ database: prisma }),
      processManagerPurge: PrismaProcessManagerPurgeRepository.create({ database: prisma }),
      migrationState: PrismaSystemMigrationStateRepository.create({ prisma }),
      migrationEnrollments: PrismaSystemMigrationEnrollmentRepository.create({ prisma }),
      migrationMemberships: PrismaMigrationMembershipRepository.create({ prisma }),
      organizationTenants: PrismaOrganizationTenantSourceRepository.create({ prisma }),
      projectTenants: PrismaProjectTenantSourceRepository.create(prisma),
      userTenants: PrismaUserTenantSourceRepository.create({ prisma }),
      organizationMemberTenants: PrismaOrganizationMemberTenantSourceRepository.create({ prisma }),
    };
  },
};
