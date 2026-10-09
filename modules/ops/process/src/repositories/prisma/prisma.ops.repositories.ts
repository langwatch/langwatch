import {
  PrismaProcessAdmin,
  PrismaProcessPurge,
  PrismaProcessStore,
} from "@langwatch/eventing/server";
import { prismaRepositories } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { UpgradeRunnerRepository } from "@langwatch/upgrade/runner";
import { TenantStepStateRepository } from "@langwatch/upgrade/step/tenant-state";

import { PostgresHealthRepository } from "../datastore-health.repository.ts";
import type { OpsRepositories } from "../ops.repositories.ts";
import { PrismaImpersonationRepository } from "./prisma.admin.repository.ts";
import { PrismaBugReportRepository } from "./prisma.bug-report.repository.ts";
import { PrismaCredentialsResealRepository } from "./prisma.credentials-reseal.repository.ts";
import { PrismaInstanceAdminRepository } from "./prisma.instance-admin.repository.ts";
import { PrismaMigrationMembershipRepository } from "./prisma.migration-membership.repository.ts";
import { PrismaOrganizationTenantSourceRepository } from "./prisma.organization-tenant-source.repository.ts";
import { PrismaProjectTenantSourceRepository } from "./prisma.project-tenant-source.repository.ts";
import { PrismaSystemMigrationEnrollmentRepository } from "./prisma.system-migration-enrollment.repository.ts";
import { PrismaSystemMigrationStateRepository } from "./prisma.system-migration-state.repository.ts";
import { PrismaUpgradeLedgerRepository } from "./prisma.upgrade-ledger.repository.ts";
import {
  PrismaOrganizationMemberTenantSourceRepository,
  PrismaUserTenantSourceRepository,
} from "./prisma.user-tenant-source.repository.ts";

/** Whether the server answers, which belongs to no tenant. */
class PrismaPostgresHealthRepository extends PostgresHealthRepository {
  private constructor(private readonly prisma: Pick<PrismaClient, "$queryRaw">) {
    super();
  }

  static create(prisma: Pick<PrismaClient, "$queryRaw">): PrismaPostgresHealthRepository {
    return new PrismaPostgresHealthRepository(prisma);
  }

  async findServerVersion(): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ server_version: string }[]>`
      -- @tenancy: asks the server its version, which belongs to no tenant.
      SHOW server_version`;
    return rows[0]?.server_version ?? "unknown version";
  }
}

const claimedOpsRepositories = prismaRepositories({
  bugReports: PrismaBugReportRepository,
});

/** The ones the live registry builds over Redis and ClickHouse. */
type NotPostgres =
  | "migrationLease"
  | "snapshots"
  | "metrics"
  | "queues"
  | "groupQueueReaper"
  | "blobStore"
  | "bugReportRateLimit"
  | "replay"
  | "replayRuntimes"
  | "pipelineDefinitions"
  | "clickhouseRoutes"
  | "anomalyState"
  | "rateTracker"
  | "storageReadings"
  | "redisHealth"
  | "clickhouseHealth"
  | "events"
  | "storageFootprint";

/** Marks the tenant step table's SQL for the tenancy guard, as the ledger repository does. */
const LEDGER_TENANCY =
  "-- @tenancy: the upgrade ledger describes the installation, not a tenant.\n";

/**
 * The claimed rows, eventing's own process store, the migration pass's Postgres reads, and the
 * operator's reads and edits across the platform's rows.
 */
export const PostgresOpsRepositories = {
  ...claimedOpsRepositories,
  create: (
    members: Parameters<typeof claimedOpsRepositories.create>[0],
  ): Omit<OpsRepositories, NotPostgres> => {
    const { prisma } = members;
    const ledgerPostgres = {
      query: async <Row extends object>(text: string, values: unknown[] = []) => ({
        rows: await prisma.$queryRawUnsafe<Row[]>(`${LEDGER_TENANCY}${text}`, ...values),
      }),
    };
    return {
      ...claimedOpsRepositories.create(members),
      processStore: PrismaProcessStore.create({ database: prisma }),
      processManagerPurge: PrismaProcessPurge.create({ database: prisma }),
      credentialsReseal: PrismaCredentialsResealRepository.create({ database: prisma }),
      migrationState: PrismaSystemMigrationStateRepository.create({ prisma }),
      migrationEnrollments: PrismaSystemMigrationEnrollmentRepository.create({ prisma }),
      migrationMemberships: PrismaMigrationMembershipRepository.create({ prisma }),
      organizationTenants: PrismaOrganizationTenantSourceRepository.create({ prisma }),
      projectTenants: PrismaProjectTenantSourceRepository.create(prisma),
      userTenants: PrismaUserTenantSourceRepository.create({ prisma }),
      organizationMemberTenants: PrismaOrganizationMemberTenantSourceRepository.create({ prisma }),
      instanceAdmin: PrismaInstanceAdminRepository.create(prisma),
      impersonation: PrismaImpersonationRepository.create(prisma),
      processFleet: PrismaProcessAdmin.create({ database: prisma }),
      postgresHealth: PrismaPostgresHealthRepository.create(prisma),
      upgradeLedger: PrismaUpgradeLedgerRepository.create({ prisma }),
      tenantStepState: TenantStepStateRepository.create({ postgres: ledgerPostgres }),
      tenantStepLedger: UpgradeRunnerRepository.create({ postgres: ledgerPostgres }),
    };
  },
};
