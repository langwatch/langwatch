import { HandledError } from "@langwatch/handled-error";

/**
 * Rolling an organization back to its legacy path is an operator action with
 * NO status precondition: the stored `rolled_back` pin is the only runtime
 * lever that keeps a pass off an organization, and a migration that enrols
 * automatically has no enrollment to withdraw instead. So every status is
 * pinnable, and so is a tenant with no record at all - see
 * `SystemMigrationsService.rollBack`. What varies is whether the migration's
 * rollback EFFECT runs, which is that method's business, not an error's.
 * The refusals that remain here are per-migration preconditions, not
 * eligibility.
 */

/**
 * A rollback refused because ANOTHER migration's state still stands on this
 * one. The canonical case (and today the only one): the authz cutover has
 * put — or is putting — the organization's grant history in charge, and the
 * genesis import / team-user backfill are the floor it stands on. Rolling
 * the floor back flips WRITES to the legacy path while reads stay wherever
 * the cutover left them, so a later revocation deletes the legacy row and
 * never the engine's — the revoked member keeps access. The operator's
 * action is in the message: roll the dependent migration back first.
 */
export class MigrationRollbackBlockedByDependentError extends HandledError {
  declare readonly code: "migration_rollback_blocked_by_dependent";

  constructor({
    blockingMigration,
    blockingStatus,
  }: {
    blockingMigration: string;
    blockingStatus: string;
  }) {
    super(
      "migration_rollback_blocked_by_dependent",
      "Another migration still depends on this one, so it cannot be rolled back yet",
      // meta is read by the presentation registry's describe() to name the
      // migration the operator has to roll back first, and the state it is
      // in.
      {
        httpStatus: 409,
        fault: "customer",
        meta: { blockingMigration, blockingStatus },
      },
    );
    this.name = "MigrationRollbackBlockedByDependentError";
  }
}

/**
 * A cutover rollback refused because the organization never actually cut
 * over: its record is `migrated` only because the cutover parks tenants
 * there while they WAIT (on unfinished prerequisites, or outside the
 * cutover cohort). There is no flip to undo and no fact to append, and
 * pinning the row `rolled_back` would strand the organization terminally
 * before it ever started.
 */
export class MigrationRollbackCutoverNotStartedError extends HandledError {
  declare readonly code: "migration_rollback_cutover_not_started";

  constructor() {
    super(
      "migration_rollback_cutover_not_started",
      "This organization has not been cut over, so there is nothing to roll back",
      { httpStatus: 409, fault: "customer" },
    );
    this.name = "MigrationRollbackCutoverNotStartedError";
  }
}

/**
 * Enrollment failures (specs/migration/system-migrations-runner.feature, the
 * enrollment scenarios). Enrollment is the cloud rollout's pacing lever, so
 * every refusal here is an operator mistake the operator can act on - a
 * handled error with a stable code, never a 500.
 */

export class MigrationEnrollmentAlreadyExistsError extends HandledError {
  declare readonly code: "migration_enrollment_already_exists";

  constructor({ migrationName }: { migrationName: string }) {
    super(
      "migration_enrollment_already_exists",
      "This organization is already enrolled for that migration",
      // meta.migrationName lets the presentation say which migration the
      // standing enrollment covers.
      { httpStatus: 409, fault: "customer", meta: { migrationName } },
    );
    this.name = "MigrationEnrollmentAlreadyExistsError";
  }
}

export class MigrationEnrollmentNotFoundError extends HandledError {
  declare readonly code: "migration_enrollment_not_found";

  constructor({ migrationName }: { migrationName: string }) {
    super(
      "migration_enrollment_not_found",
      "This organization is not enrolled for that migration",
      { httpStatus: 404, fault: "customer", meta: { migrationName } },
    );
    this.name = "MigrationEnrollmentNotFoundError";
  }
}

/**
 * An enrollment action refused because the migration admits every
 * organization already (`enrolledAutomatically`). The row would decide
 * nothing, and accepting it would tell the operator they had paced something
 * they had not - so the action refuses rather than writing inert
 * bookkeeping.
 */
export class MigrationEnrolledAutomaticallyError extends HandledError {
  declare readonly code: "migration_enrolled_automatically";

  constructor({ migrationName }: { migrationName: string }) {
    super(
      "migration_enrolled_automatically",
      "This migration already runs for every organization, so there is nothing to enroll",
      // meta.migrationName lets the presentation name the migration.
      { httpStatus: 409, fault: "customer", meta: { migrationName } },
    );
    this.name = "MigrationEnrolledAutomaticallyError";
  }
}

/** A migration name nothing registered answers to. */
export class MigrationUnknownError extends HandledError {
  declare readonly code: "migration_unknown";

  constructor() {
    super("migration_unknown", "No migration exists with that name", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "MigrationUnknownError";
  }
}

/**
 * A targeted run refused because the organization is not enrolled for the
 * migration (cloud only - self-hosted has no enrollment). Enrollment stays
 * the single pacing source of truth: a run that bypassed it would be an
 * unenrolled organization migrating anyway.
 */
export class MigrationRunRequiresEnrollmentError extends HandledError {
  declare readonly code: "migration_run_requires_enrollment";

  constructor({ migrationName }: { migrationName: string }) {
    super(
      "migration_run_requires_enrollment",
      "Enroll this organization for the migration before running it",
      { httpStatus: 409, fault: "customer", meta: { migrationName } },
    );
    this.name = "MigrationRunRequiresEnrollmentError";
  }
}

/**
 * A targeted run refused because another pass holds this organization's
 * claim - it is being migrated right now. Not a failure of anything: the
 * operator's action is simply to retry once that pass concludes.
 */
export class MigrationPassAlreadyRunningError extends HandledError {
  declare readonly code: "migration_pass_already_running";

  constructor() {
    super(
      "migration_pass_already_running",
      "Another migration pass appears to be working this organization; try again shortly",
      { httpStatus: 409, fault: "customer" },
    );
    this.name = "MigrationPassAlreadyRunningError";
  }
}

/**
 * A targeted run refused on a self-hosted installation for a migration not
 * yet released there. The runner never drives it for any tenant until a
 * release flips its declaration, and a targeted run must not become the
 * bypass.
 */
export class MigrationNotAvailableOnInstallationError extends HandledError {
  declare readonly code: "migration_not_available_on_installation";

  constructor() {
    super(
      "migration_not_available_on_installation",
      "This migration is not yet available for this installation",
      { httpStatus: 400, fault: "customer" },
    );
    this.name = "MigrationNotAvailableOnInstallationError";
  }
}

/**
 * Enrollment exists to pace the CLOUD rollout. On a self-hosted installation
 * it could only ever be a lie in the interface: released migrations already
 * run for every organization with no enrollment, and unreleased ones run for
 * nobody however many rows exist. So rather than accept a row that changes
 * nothing, both enrollment actions refuse outright off cloud.
 */
export class MigrationEnrollmentCloudOnlyError extends HandledError {
  declare readonly code: "migration_enrollment_cloud_only";

  constructor() {
    super(
      "migration_enrollment_cloud_only",
      "Enrollment does not apply to this installation",
      { httpStatus: 400, fault: "customer" },
    );
    this.name = "MigrationEnrollmentCloudOnlyError";
  }
}

/** An enrollment naming an organization id that does not exist. */
export class MigrationEnrollmentOrganizationNotFoundError extends HandledError {
  declare readonly code: "organization_not_found";

  constructor() {
    super("organization_not_found", "Organization not found", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "MigrationEnrollmentOrganizationNotFoundError";
  }
}
