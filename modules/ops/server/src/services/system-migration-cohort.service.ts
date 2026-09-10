import type { SystemMigration } from "@langwatch/system-migrations";
import { organizationMigrates } from "../rules/ops-system-migration-cohort.rules.ts";
import type {
  OrganizationDataplane,
  OrganizationDataplanePort,
} from "../app/ops.app.ts";

/** One organization's place in one migration's cohort, and where it lives. */
export type OrganizationCohortAdmission = Readonly<{
  admitted: boolean;
  /**
   * Named on every admission, not only the private ones: an operator reading a
   * pass has to be able to tell which instance the work landed on, and "the
   * shared one" is an answer rather than a gap.
   */
  dataplane: OrganizationDataplane;
}>;

/**
 * Who is in an organization-rooted migration's cohort.
 *
 * Enrollment is read once, fresh, at the start of a pass rather than per
 * tenant — one query instead of one per tenant per migration — and the
 * dataplane is asked per organization from a table already in memory.
 *
 * A dedicated data plane is NOT a reason to leave an organization out: the
 * routing places an organization-rooted append on that organization's own
 * instance, so an automatic cohort admits a private-dataplane organization and
 * says which endpoint it landed on. Excluding them would strand exactly those
 * customers on their legacy path forever.
 */
export class SystemMigrationCohortService {
  static create(deps: {
    isSaaS: boolean;
    /** migration name -> the organization ids an operator enrolled for it. */
    enrolled: ReadonlyMap<string, ReadonlySet<string>>;
    migrations: readonly SystemMigration[];
    dataplane: OrganizationDataplanePort;
  }): SystemMigrationCohortService {
    return new SystemMigrationCohortService(deps);
  }

  private readonly automatic: ReadonlySet<string>;

  private constructor(
    private readonly deps: {
      isSaaS: boolean;
      enrolled: ReadonlyMap<string, ReadonlySet<string>>;
      migrations: readonly SystemMigration[];
      dataplane: OrganizationDataplanePort;
    },
  ) {
    this.automatic = new Set(
      deps.migrations.filter((one) => one.enrolledAutomatically).map((one) => one.name),
    );
  }

  admits({
    organizationId,
    migrationName,
  }: {
    organizationId: string;
    migrationName: string;
  }): OrganizationCohortAdmission {
    return {
      admitted: organizationMigrates({
        isSaaS: this.deps.isSaaS,
        enrolledAutomatically: this.automatic.has(migrationName),
        enrolled: this.deps.enrolled.get(migrationName)?.has(organizationId) ?? false,
      }),
      dataplane: this.deps.dataplane.dataplaneFor(organizationId),
    };
  }
}
