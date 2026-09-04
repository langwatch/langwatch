import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { Cluster, Redis } from "ioredis";
import {
  type MigrationPassSummary,
  type SystemMigration,
  SystemMigrationRunnerService,
} from "@langwatch/system-migrations";
import {
  migrationRunsOnThisInstallation,
  organizationMigrates,
} from "../ops.system-migration-cohort";
import { RedisMigrationLeaseRepository } from "../repositories/redis/redis.migration-lease.repository";
import { PrismaOrganizationTenantSource } from "../repositories/prisma/prisma.organization-tenant-source.repository";
import { PrismaSystemMigrationEnrollmentRepository } from "../repositories/prisma/prisma.system-migration-enrollment.repository";
import { PrismaSystemMigrationStateRepository } from "../repositories/prisma/prisma.system-migration-state.repository";

export type PostgresSystemMigrationsAdapterOptions = Readonly<{
  database: PrismaClient;
  redis: Redis | Cluster | null;
  /** Cloud pacing is per-organization enrollment; self-hosted admits everyone. */
  isSaaS: () => boolean;
  /**
   * The organization-rooted migrations this installation registered, and only
   * that axis: the USER-rooted leg (ADR-101 §6) is admitted per user through
   * organization membership, a cohort this adapter does not implement.
   */
  migrations: () => readonly SystemMigration[];
}>;

/**
 * Composes one migration pass over this feature's Prisma state, enrollment and
 * tenant-source repositories and its Redis lease. Was main's
 * `app-layer/system-migrations/runtime.ts`, minus the migration registry.
 */
export class PostgresSystemMigrationsAdapter {
  static create(options: PostgresSystemMigrationsAdapterOptions): PostgresSystemMigrationsAdapter {
    return new PostgresSystemMigrationsAdapter(options);
  }

  private constructor(private readonly options: PostgresSystemMigrationsAdapterOptions) {}

  async runPass({ signal }: { signal?: AbortSignal }): Promise<MigrationPassSummary> {
    const isSaaS = this.options.isSaaS();
    const state = new PrismaSystemMigrationStateRepository(this.options.database);
    const lease = new RedisMigrationLeaseRepository(this.options.redis);
    const enrollments = new PrismaSystemMigrationEnrollmentRepository(this.options.database);

    const migrations = this.released({ migrations: this.options.migrations(), isSaaS });
    const cohort = await this.cohort({ isSaaS, enrollments, migrations });

    return new SystemMigrationRunnerService({
      state,
      lease,
      tenants: new PrismaOrganizationTenantSource(this.options.database),
      cohort,
      migrations,
    }).runPass({ signal });
  }

  /** Self-hosted drives only the migrations already released for it. */
  private released({
    migrations,
    isSaaS,
  }: {
    migrations: readonly SystemMigration[];
    isSaaS: boolean;
  }): readonly SystemMigration[] {
    return migrations.filter((migration) =>
      migrationRunsOnThisInstallation({
        isSaaS,
        runsAutomaticallyOnSelfHosted: migration.runsAutomaticallyOnSelfHosted,
      }),
    );
  }

  /**
   * Read once, fresh, at the start of the run rather than per tenant: one
   * query instead of one per tenant per migration. Self-hosted never reads
   * enrollment at all — there is nothing to pace.
   */
  private async cohort({
    isSaaS,
    enrollments,
    migrations,
  }: {
    isSaaS: boolean;
    enrollments: PrismaSystemMigrationEnrollmentRepository;
    migrations: readonly SystemMigration[];
  }): Promise<(args: { tenantId: string; migrationName: string }) => boolean> {
    const automatic = new Set(
      migrations.filter((one) => one.enrolledAutomatically).map((one) => one.name),
    );
    const enrolled = isSaaS
      ? await enrollments.findEnrolledOrganizationIdsByMigration()
      : new Map<string, Set<string>>();
    return ({ tenantId, migrationName }) =>
      organizationMigrates({
        isSaaS,
        enrolledAutomatically: automatic.has(migrationName),
        enrolled: enrolled.get(migrationName)?.has(tenantId) ?? false,
      });
  }
}
