import { HandledError } from "@langwatch/handled-error";

/** Rollback has no status precondition; stored rolled_back pin is the only
 * runtime lever. These refusals are per-migration preconditions, not eligibility. */

/** Rollback refused when another migration's state depends on this one;
 * rolling the floor back flips writes to the legacy path while reads stay elsewhere. */
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
 * Refused because the organization never cut over - its `migrated` record
 * only means the cutover is parking it (unfinished prerequisites, or outside
 * the cohort). Nothing to flip, so pinning `rolled_back` would strand it.
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
 * Enrollment failures (specs/migration/system-migrations-runner.feature).
 * Enrollment paces the cloud rollout, so every refusal here is an operator
 * mistake the operator can act on - never a 500.
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
 * Refused because the migration already admits every organization
 * (`enrolledAutomatically`) - the row would decide nothing, and accepting it
 * would tell the operator they had paced something they had not.
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
 * Refused because the organization is not enrolled (cloud only -
 * self-hosted has no enrollment). Enrollment is the single pacing source of
 * truth; bypassing it would run an unenrolled organization anyway.
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
 * Refused on self-hosted for a migration not yet released there - the
 * runner never drives it for any tenant until release flips its
 * declaration, and a targeted run must not become the bypass.
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
 * Enrollment paces the cloud rollout only - off cloud, released migrations
 * already run for everyone and unreleased ones run for nobody regardless of
 * rows, so both enrollment actions refuse outright.
 */
export class MigrationEnrollmentCloudOnlyError extends HandledError {
  declare readonly code: "migration_enrollment_cloud_only";

  constructor() {
    super("migration_enrollment_cloud_only", "Enrollment does not apply to this installation", {
      httpStatus: 400,
      fault: "customer",
    });
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

/**
 * Rollback accepts a missing record (it pins the organization out ahead of
 * the pass); the drain proof cannot, because the proof is written onto the
 * migration's own report, which requires the record to exist.
 */
export class MigrationStateNotFoundError extends HandledError {
  declare readonly code: "migration_state_not_found";

  constructor() {
    super("migration_state_not_found", "No migration state exists for that organization", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "MigrationStateNotFoundError";
  }
}

export class MigrationDrainProofRequiresMigratedError extends HandledError {
  declare readonly code: "migration_drain_proof_requires_migrated";

  constructor({ status }: { status: string }) {
    super(
      "migration_drain_proof_requires_migrated",
      "Legacy writer drain can only be asserted for a held migrated organization",
      { httpStatus: 409, fault: "customer", meta: { status } },
    );
    this.name = "MigrationDrainProofRequiresMigratedError";
  }
}
