/**
 * Who is enrolled in a migration and who may be: the listing the ops page reads, the cohort an
 * operator opens a rollout to, and the withdrawal that pauses one. A migration that admits every
 * organization anyway is refused here, since there is nothing an enrollment could decide for it.
 */

import { createLogger } from "@langwatch/observability";
import {
  MigrationEnrolledAutomaticallyError,
  MigrationEnrollmentCloudOnlyError,
  MigrationEnrollmentOrganizationNotFoundError,
} from "@langwatch/ops-contract";
import {
  requireRegisteredMigration,
  sample,
  type MigrationEnrollmentRecord,
  type SystemMigrationsServiceDependencies,
} from "./system-migration-support.service";

const logger = createLogger("langwatch:ops:system-migrations");

export class SystemMigrationEnrollmentService {
  static create(deps: SystemMigrationsServiceDependencies): SystemMigrationEnrollmentService {
    return new SystemMigrationEnrollmentService(deps);
  }

  private constructor(private readonly deps: SystemMigrationsServiceDependencies) {}

  /**
   * The enrollment listing for the ops page: every migration's, newest first, with whatever names still resolve. `isSaaS` rides
   * along so the page can say honestly that a self-hosted installation has nothing to enroll. The read is audited because the
   * records carry the enrollers' display names - personal data leaves through here, so the trail says who read it.
   */
  async getEnrollments({ requestedBy }: { requestedBy: string }): Promise<{
    isSaaS: boolean;
    enrollments: MigrationEnrollmentRecord[];
  }> {
    const enrollments = await this.deps.enrollments.findAll();
    await this.deps.audit({
      userId: requestedBy,
      action: "systemMigrations.listEnrollments",
    });

    return { isSaaS: this.deps.isSaaS(), enrollments };
  }

  /**
   * The operator's organization lookup for the page's pickers - enroll,
   * targeted run and rollback all act on an organization the operator found
   * by name rather than by pasting an id.
   */
  async searchOrganizations({
    query,
  }: {
    query: string;
  }): Promise<Array<{ id: string; name: string }>> {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return [];
    }

    return this.deps.enrollments.searchOrganizations({ query: trimmed });
  }

  /**
   * Enrolls one organization for one registered migration, taking effect on the next pass since
   * the runner reads enrollment fresh. It refuses rather than lies: off cloud, for a migration
   * that already admits everyone or that nothing answers to, and for an unknown or enrolled org.
   */
  async enroll({
    organizationId,
    migrationName,
    actorUserId,
  }: {
    organizationId: string;
    migrationName: string;
    actorUserId: string;
  }): Promise<void> {
    if (!this.deps.isSaaS()) {
      throw new MigrationEnrollmentCloudOnlyError();
    }

    requireRegisteredMigration(this.deps, migrationName);
    this.requireEnrollmentDecidesSomething(migrationName);
    const organization = await this.deps.enrollments.tryFindOrganizationById({
      organizationId,
    });
    if (!organization) {
      throw new MigrationEnrollmentOrganizationNotFoundError();
    }

    await this.deps.enrollments.create({
      organizationId,
      migrationName,
      enrolledByUserId: actorUserId,
    });
    logger.info(
      { organizationId, migrationName, actorUserId },
      "operator enrolled an organization for the in-place migration rollout",
    );
    await this.deps.audit({
      userId: actorUserId,
      organizationId,
      action: "systemMigrations.enroll",
      args: { migrationName },
    });
  }

  /**
   * Enrolls a sampled cohort for one migration in a single action. The pool is every organization
   * not yet enrolled, minus the ones the platform knows to leave alone by data. The sample is
   * random, and the result names every organization it picked: an action over N must say which N.
   */
  async enrollCohort({
    migrationName,
    sampleSize,
    actorUserId,
    includeEnterprise = false,
    includePrivateDataplane = false,
  }: {
    migrationName: string;
    sampleSize: number;
    actorUserId: string;
    /** Draw organizations with an active or pending ENTERPRISE subscription. */
    includeEnterprise?: boolean;
    /** Draw organizations whose events live in their own ClickHouse instance. */
    includePrivateDataplane?: boolean;
  }): Promise<{
    enrolled: Array<{ id: string; name: string }>;
    eligibleCount: number;
  }> {
    if (!this.deps.isSaaS()) {
      throw new MigrationEnrollmentCloudOnlyError();
    }

    requireRegisteredMigration(this.deps, migrationName);
    this.requireEnrollmentDecidesSomething(migrationName);
    // The steps run as an ordered pipeline per organization, so a later
    // step's pool is the step before it: an organization enrolled for a
    // step whose predecessor nothing will ever run would sit pending
    // forever. The first step keeps sampling the whole installation.
    const ordered = this.deps.migrations();
    const index = ordered.findIndex((migration) => migration.name === migrationName);
    const previous = index > 0 ? ordered[index - 1] : undefined;
    const eligible = await this.deps.enrollments.findCohortEligibleOrganizations({
      migrationName,
      enrolledForMigrationName: previous?.name,
      // Two independent switches, and both are the operator's. Naming no ids
      // IS the private-dataplane lift: the environment's routing table stays
      // the only place those organizations are listed, so an empty exclusion
      // draws them rather than a second list repeating them.
      excludeOrganizationIds: includePrivateDataplane
        ? []
        : this.deps.privateDataplaneOrganizationIds(),
      includeEnterprise,
    });
    const picked = sample({ pool: eligible, count: sampleSize });
    const { insertedCount } = await this.deps.enrollments.createMany({
      organizationIds: picked.map((organization) => organization.id),
      migrationName,
      enrolledByUserId: actorUserId,
    });
    logger.info(
      {
        migrationName,
        actorUserId,
        sampleSize,
        // Both counts on purpose: `skipDuplicates` drops a row a concurrent
        // single enrollment already wrote, and the trail must not overclaim.
        pickedCount: picked.length,
        insertedCount,
        eligibleCount: eligible.length,
        // Which exclusions this cohort lifted, so a widened pool is legible
        // in the log rather than inferred from an unusually large sample.
        includeEnterprise,
        includePrivateDataplane,
        organizationIds: picked.map((organization) => organization.id),
      },
      "operator enrolled a cohort for the in-place migration rollout",
    );
    // One audit row PER organization, mirroring `enroll`'s shape: the row's
    // indexed organizationId column is how "what touched org X" is answered,
    // and a single row holding a thousand-id array loses every id to the
    // audit writer's size cap.
    for (const organization of picked) {
      await this.deps.audit({
        userId: actorUserId,
        organizationId: organization.id,
        action: "systemMigrations.enrollCohort",
        args: {
          migrationName,
          sampleSize,
          cohortSize: picked.length,
          // On the row itself, not only in the log: "was this organization
          // drawn because an operator lifted an exclusion?" is a question
          // asked of one organization, and the audit trail is where it is
          // answered.
          includeEnterprise,
          includePrivateDataplane,
        },
      });
    }

    return { enrolled: picked, eligibleCount: eligible.length };
  }

  /**
   * Withdraw an enrollment: the row is deleted, and the next pass simply no longer processes the organization for that migration. State
   * already recorded stays exactly as it is - withdrawal pauses the rollout, it does not roll anything back (that is the operator rollback's
   * job). Refused for a migration that admits every organization anyway, where deleting a row would pause nothing.
   */
  async withdraw({
    organizationId,
    migrationName,
    actorUserId,
  }: {
    organizationId: string;
    migrationName: string;
    actorUserId: string;
  }): Promise<void> {
    if (!this.deps.isSaaS()) {
      throw new MigrationEnrollmentCloudOnlyError();
    }

    this.requireEnrollmentDecidesSomething(migrationName);
    await this.deps.enrollments.delete({ organizationId, migrationName });
    logger.info(
      { organizationId, migrationName, actorUserId },
      "operator withdrew an organization from the in-place migration rollout",
    );
    await this.deps.audit({
      userId: actorUserId,
      organizationId,
      action: "systemMigrations.withdraw",
      args: { migrationName },
    });
  }

  /**
   * Refuses an enrollment action on a migration that admits every organization anyway. Withdrawal asks
   * this too: pausing a rollout is what an operator withdraws FOR, and a migration outside enrollment's
   * reach cannot be paused that way - the per-organization rollback is the lever that still works on it.
   */
  private requireEnrollmentDecidesSomething(migrationName: string): void {
    const migration = this.deps.migrations().find((candidate) => candidate.name === migrationName);
    if (migration?.enrolledAutomatically) {
      throw new MigrationEnrolledAutomaticallyError({ migrationName });
    }
  }
}
