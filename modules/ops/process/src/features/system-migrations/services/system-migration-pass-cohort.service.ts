import { createLogger } from "@langwatch/observability";
import type { MigrationCohort, SystemMigration } from "@langwatch/system-migrations";
import type { TenantMigrationStep } from "@langwatch/upgrade/step";

import type { OrganizationDataplaneResolver } from "../../../app/ops.app.ts";
import type { OpsRepositories } from "../../../repositories/ops.repositories.ts";
import { ProjectHasNoOrganizationError } from "../../../repositories/tenant-source.repository.ts";
import { userMigrates } from "../../../rules/ops-system-migration-cohort.rules.ts";
import { RoutingTableOrganizationDataplaneService } from "../../../services/organization-dataplane.service.ts";
import { SystemMigrationCohortService } from "./system-migration-cohort.service.ts";

const logger = createLogger("langwatch:ops:system-migrations:pass");

type Enrollments = OpsRepositories["migrationEnrollments"];

/** Which tenants a pass admits, per axis: enrollment read once, fresh, at the start of a pass. */
export class SystemMigrationPassCohortService {
  static create(options: {
    repositories: Pick<
      OpsRepositories,
      "migrationEnrollments" | "migrationMemberships" | "projectTenants"
    >;
    dataplane?: OrganizationDataplaneResolver;
  }): SystemMigrationPassCohortService {
    return new SystemMigrationPassCohortService(options);
  }

  private constructor(
    private readonly options: Parameters<typeof SystemMigrationPassCohortService.create>[0],
  ) {}

  /** Enrolment paces every axis: a project through its organization, a user by membership. */
  async declared({
    axis,
    isSaaS,
    migrations,
  }: {
    axis: TenantMigrationStep["tenants"];
    isSaaS: boolean;
    migrations: readonly SystemMigration[];
  }): Promise<MigrationCohort> {
    const enrollments = this.options.repositories.migrationEnrollments;
    if (axis === "user") return this.user({ isSaaS, enrollments, migrations });
    const organizationCohort = await this.organization({ isSaaS, enrollments, migrations });
    if (axis === "organization" || !isSaaS) return organizationCohort;
    return this.throughOwningOrganization({ organizationCohort });
  }

  /**
   * A project admitted through its organization. The owners are read a page at a time and kept
   * for the pass: one read per page of projects, not one per project per migration.
   */
  throughOwningOrganization({
    organizationCohort,
  }: {
    organizationCohort: (args: { tenantId: string; migrationName: string }) => boolean;
  }): MigrationCohort {
    const projects = this.options.repositories.projectTenants;
    const owners = new Map<string, string>();
    const orphans = new Set<string>();
    const prepare = async ({ tenantIds }: { tenantIds: readonly string[] }): Promise<void> => {
      const unknown = tenantIds.filter((projectId) => !owners.has(projectId));
      if (unknown.length === 0) return;
      for (const { projectId, organizationId } of await projects.findOrganizationIds({
        projectIds: unknown,
      })) {
        owners.set(projectId, organizationId);
      }
    };
    const admits = async ({
      tenantId,
      migrationName,
    }: {
      tenantId: string;
      migrationName: string;
    }) => {
      if (orphans.has(tenantId)) return false;
      let organizationId = owners.get(tenantId);
      if (organizationId === undefined) {
        try {
          organizationId = await projects.getOrganizationId(tenantId);
        } catch (error) {
          if (!(error instanceof ProjectHasNoOrganizationError)) throw error;
          orphans.add(tenantId);
          // An orphan project (no team, so no organization) belongs to no enrolled cohort.
          logger.warn(
            { projectId: tenantId, migrationName },
            "skipping project with no owning organization",
          );
          return false;
        }
        owners.set(tenantId, organizationId);
      }
      return organizationCohort({ tenantId: organizationId, migrationName });
    };
    return Object.assign(admits, { prepare });
  }

  /**
   * The user-rooted leg's cohort. Enrollment is read once, fresh, at the start
   * of the pass; membership is answered per candidate user against the
   * enrolled organizations only.
   */
  async user({
    isSaaS,
    enrollments,
    migrations,
  }: {
    isSaaS: boolean;
    enrollments: Enrollments;
    migrations: readonly SystemMigration[];
  }): Promise<MigrationCohort> {
    const automatic = new Set(
      migrations.filter((one) => one.enrolledAutomatically).map((one) => one.name),
    );
    const memberships = this.options.repositories.migrationMemberships;
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
   * Read once, fresh, at the start of the run rather than per tenant: one
   * query instead of one per tenant per migration. Self-hosted never reads
   * enrollment at all - there is nothing to pace.
   */
  async organization({
    isSaaS,
    enrollments,
    migrations,
  }: {
    isSaaS: boolean;
    enrollments: Enrollments;
    migrations: readonly SystemMigration[];
  }): Promise<(args: { tenantId: string; migrationName: string }) => boolean> {
    const enrolled = isSaaS
      ? await enrollments.findEnrolledOrganizationIdsByMigration()
      : new Map<string, Set<string>>();
    const cohort = SystemMigrationCohortService.create({
      isSaaS,
      enrolled,
      migrations,
      dataplane:
        this.options.dataplane ??
        RoutingTableOrganizationDataplaneService.create({ routes: new Map() }),
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
