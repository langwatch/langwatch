/**
 * Running one migration for one organization now, rather than waiting for the next pass: what makes
 * an organization runnable at all, and the status its record reports back. The cohort stays the
 * source of truth on cloud, and the organization's own claim still refuses a concurrent pass.
 */

import { createLogger } from "@langwatch/observability";
import type { TenantMigrationStatus } from "@langwatch/system-migrations";
import {
  MigrationEnrollmentOrganizationNotFoundError,
  MigrationNotAvailableOnInstallationError,
  MigrationPassAlreadyRunningError,
  MigrationRunRequiresEnrollmentError,
} from "@langwatch/ops-contract";
import {
  requireRegisteredMigration,
  statusOfMemberSummary,
  type SystemMigrationsServiceDependencies,
} from "./system-migration-support.service";

const logger = createLogger("langwatch:ops:system-migrations");

export class SystemMigrationRunService {
  static create(deps: SystemMigrationsServiceDependencies): SystemMigrationRunService {
    return new SystemMigrationRunService(deps);
  }

  private constructor(private readonly deps: SystemMigrationsServiceDependencies) {}

  async runForOrganization({
    organizationId,
    migrationName,
    actorUserId,
  }: {
    organizationId: string;
    migrationName: string;
    actorUserId: string;
  }): Promise<{ status: TenantMigrationStatus | null; waiting: boolean }> {
    const migration = requireRegisteredMigration(this.deps, migrationName);
    await this.requireRunnableForOrganization({
      migration,
      organizationId,
      migrationName,
    });
    await this.deps.audit({
      userId: actorUserId,
      organizationId,
      action: "systemMigrations.runForOrganization",
      args: { migrationName },
    });
    const summary = await this.deps.runTargetedPass({
      organizationId,
      migrationName,
    });
    // Every tenant the run covered was claimed elsewhere, so this run did nothing and the operator should
    // retry. For an organization-rooted run that is one tenant, so `claimed > 0` and this condition are
    // the same thing. For a USER-rooted run the tenants are the organization's members, and one contended
    // member is partial progress: aborting on it would discard the outcomes of every member that
    // finalized, and the operator would be told to retry a run that mostly succeeded.
    if (summary.claimed > 0 && summary.claimed === summary.tenantsSeen) {
      throw new MigrationPassAlreadyRunningError();
    }

    if ((migration.tenant ?? "organization") === "user") {
      // The tenants were the organization's members, so there is no single
      // record to read back: the pass summary is the answer. Any held,
      // parked or still-contended member keeps the organization on the
      // operator's list.
      return { status: statusOfMemberSummary(summary), waiting: false };
    }

    return this.organizationRecordStatus({ migrationName, organizationId });
  }

  private async requireRunnableForOrganization({
    migration,
    organizationId,
    migrationName,
  }: {
    migration: {
      runsAutomaticallyOnSelfHosted: boolean;
      enrolledAutomatically: boolean;
    };
    organizationId: string;
    migrationName: string;
  }): Promise<void> {
    if (!this.deps.isSaaS() && !migration.runsAutomaticallyOnSelfHosted) {
      throw new MigrationNotAvailableOnInstallationError();
    }

    const organization = await this.deps.enrollments.tryFindOrganizationById({
      organizationId,
    });
    if (!organization) {
      throw new MigrationEnrollmentOrganizationNotFoundError();
    }

    if (!this.deps.isSaaS()) {
      return;
    }

    // Nothing to be outside of: the migration admits every organization, so
    // a targeted run only brings this one's turn forward.
    if (migration.enrolledAutomatically) {
      return;
    }

    const enrolled = await this.deps.enrollments.isEnrolled({
      organizationId,
      migrationName,
    });
    if (!enrolled) {
      throw new MigrationRunRequiresEnrollmentError({ migrationName });
    }
  }

  private async organizationRecordStatus({
    migrationName,
    organizationId,
  }: {
    migrationName: string;
    organizationId: string;
  }): Promise<{ status: TenantMigrationStatus | null; waiting: boolean }> {
    const record = await this.deps.state.tryFindRecord({
      migrationName,
      tenantId: organizationId,
    });

    // `migrated` covers two outcomes an operator must not confuse: the
    // migration ran and is held for review, or it did nothing because it is
    // still waiting. Only the migration's own report tells them apart, so
    // the status alone would report a waiting cutover as a held one.
    return {
      status: record?.status ?? null,
      waiting:
        record != null && (this.deps.waitingReports?.[migrationName]?.(record.report) ?? false),
    };
  }
}
