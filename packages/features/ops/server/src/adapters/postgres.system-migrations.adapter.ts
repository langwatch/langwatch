import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { Cluster, Redis } from "ioredis";
import {
  type MigrationCohort,
  type MigrationPassSummary,
  type SystemMigration,
  SystemMigrationRunnerService,
} from "@langwatch/system-migrations";
import { createLogger } from "@langwatch/observability";
import {
  migrationRunsOnThisInstallation,
  userMigrates,
} from "../rules/ops-system-migration-cohort.rules";
import { NullOrganizationDataplaneAdapter } from "./null.organization-dataplane.adapter";
import type { OrganizationDataplanePort } from "../ports/organization-dataplane.port";
import { SystemMigrationCohortService } from "../services/system-migration-cohort.service";
import { PrismaMigrationMembershipRepository } from "../repositories/prisma/prisma.migration-membership.repository";
import { PrismaUserTenantSourceRepository } from "../repositories/prisma/prisma.user-tenant-source.repository";
import { RedisMigrationLeaseRepository } from "../repositories/redis/redis.migration-lease.repository";
import { PrismaOrganizationTenantSourceRepository } from "../repositories/prisma/prisma.organization-tenant-source.repository";
import { PrismaSystemMigrationEnrollmentRepository } from "../repositories/prisma/prisma.system-migration-enrollment.repository";
import { PrismaSystemMigrationStateRepository } from "../repositories/prisma/prisma.system-migration-state.repository";

const logger = createLogger("langwatch:ops:system-migrations:pass");

/** Both legs count into one summary: the convergence loop stops when a whole
 *  pass moved nothing, so one leg still advancing has to keep it non-zero. */
function mergeSummaries(a: MigrationPassSummary, b: MigrationPassSummary): MigrationPassSummary {
  return {
    tenantsSeen: a.tenantsSeen + b.tenantsSeen,
    finalized: a.finalized + b.finalized,
    held: a.held + b.held,
    parked: a.parked + b.parked,
    skipped: a.skipped + b.skipped,
    alreadyFinalized: a.alreadyFinalized + b.alreadyFinalized,
    alreadyRolledBack: a.alreadyRolledBack + b.alreadyRolledBack,
    claimed: a.claimed + b.claimed,
    advanced: a.advanced + b.advanced,
  };
}

export type PostgresSystemMigrationsAdapterOptions = Readonly<{
  database: PrismaClient;
  redis: Redis | Cluster | null;
  /** Cloud pacing is per-organization enrollment; self-hosted admits everyone. */
  isSaaS: () => boolean;
  /** The organization-rooted migrations this installation registered. */
  migrations: () => readonly SystemMigration[];
  /**
   * The USER-rooted migrations this installation registered (ADR-101 §6),
   * driven as a second leg of the same pass over the same lease and state
   * table. Admitted per user through organization membership.
   */
  userMigrations: () => readonly SystemMigration[];
  /**
   * The abandoned-newborn sweep (ADR-116 §3), on the pass's own cadence. A LEG
   * rather than a registered migration, because what it hunts is a claim with
   * no user row behind it — a tenant no source enumerates.
   */
  newbornSweep: () => Promise<unknown>;
  /**
   * Where each organization's data lives. Not a filter — a private data plane
   * never holds an organization back — but a pass that admits one says which
   * instance it landed on. Omitted, every organization reads as shared.
   */
  dataplane?: OrganizationDataplanePort;
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
    const state = PrismaSystemMigrationStateRepository.create({ prisma: this.options.database });
    const lease = RedisMigrationLeaseRepository.create({ redis: this.options.redis });
    const enrollments = PrismaSystemMigrationEnrollmentRepository.create({
      prisma: this.options.database,
    });

    const migrations = this.released({ migrations: this.options.migrations(), isSaaS });
    const userMigrations = this.released({ migrations: this.options.userMigrations(), isSaaS });
    // Both legs' cohorts resolve BEFORE either pass starts, so the two legs
    // read enrollment at the same moment: an operator enrolling mid-pass moves
    // both legs on the next pass, never one leg now and the other later.
    const cohort = await this.cohort({ isSaaS, enrollments, migrations });
    const userCohort =
      userMigrations.length === 0
        ? null
        : await this.userCohort({ isSaaS, enrollments, migrations: userMigrations });

    const summary = await new SystemMigrationRunnerService({
      state,
      lease,
      tenants: PrismaOrganizationTenantSourceRepository.create({ prisma: this.options.database }),
      cohort,
      migrations,
    }).runPass({ signal });

    const merged =
      userCohort === null
        ? summary
        : mergeSummaries(
            summary,
            await new SystemMigrationRunnerService({
              state,
              lease,
              tenants: PrismaUserTenantSourceRepository.create({ prisma: this.options.database }),
              cohort: userCohort,
              migrations: userMigrations,
            }).runPass({ signal }),
          );

    await this.sweepAbandonedNewborns();
    return merged;
  }

  /**
   * The user-rooted leg's cohort. Enrollment is read once, fresh, at the start
   * of the pass; membership is answered per candidate user against the
   * enrolled organizations only.
   */
  async userCohort({
    isSaaS,
    enrollments,
    migrations,
  }: {
    isSaaS: boolean;
    enrollments: PrismaSystemMigrationEnrollmentRepository;
    migrations: readonly SystemMigration[];
  }): Promise<MigrationCohort> {
    const automatic = new Set(
      migrations.filter((one) => one.enrolledAutomatically).map((one) => one.name),
    );
    const memberships = PrismaMigrationMembershipRepository.create({
      prisma: this.options.database,
    });
    const enrolled = isSaaS
      ? await enrollments.findEnrolledOrganizationIdsByMigration()
      : new Map<string, Set<string>>();
    return async ({ tenantId, migrationName }) => {
      const enrolledAutomatically = automatic.has(migrationName);
      const organizationIds = [...(enrolled.get(migrationName) ?? [])];
      const memberOfEnrolledOrganization =
        isSaaS && !enrolledAutomatically && organizationIds.length > 0
          ? await memberships.isMemberOfAny({ userId: tenantId, organizationIds })
          : false;
      return userMigrates({ isSaaS, enrolledAutomatically, memberOfEnrolledOrganization });
    };
  }

  /**
   * Never terminal: the sweep removes rows the pass did not write, so a pass
   * that reported nothing because a sweep threw would hide the migration
   * outcome an operator asked for.
   */
  private async sweepAbandonedNewborns(): Promise<void> {
    try {
      await this.options.newbornSweep();
    } catch (error) {
      logger.warn(
        { error },
        "the abandoned-newborn sweep failed; the claims stay and the next pass retries",
      );
    }
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
    const enrolled = isSaaS
      ? await enrollments.findEnrolledOrganizationIdsByMigration()
      : new Map<string, Set<string>>();
    const cohort = SystemMigrationCohortService.create({
      isSaaS,
      enrolled,
      migrations,
      dataplane: this.options.dataplane ?? NullOrganizationDataplaneAdapter.create(),
    });
    return ({ tenantId, migrationName }) => {
      const admission = cohort.admits({ organizationId: tenantId, migrationName });
      if (admission.admitted && admission.dataplane.kind === "private") {
        logger.debug(
          { migrationName, organizationId: tenantId, endpoint: admission.dataplane.endpoint },
          "organization with a dedicated data plane is in this migration's cohort",
        );
      }
      return admission.admitted;
    };
  }
}
