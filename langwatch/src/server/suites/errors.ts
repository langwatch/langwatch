/**
 * Domain-specific error types for suite operations.
 *
 * These errors represent business rule violations in the suite domain,
 * allowing callers to handle different failure modes precisely.
 */

/** Base class for all suite domain errors */
export class SuiteDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuiteDomainError";
  }
}

/** Thrown when a suite references scenarios that do not exist */
export class InvalidScenarioReferencesError extends SuiteDomainError {
  readonly invalidIds: string[];

  constructor({ invalidIds }: { invalidIds: string[] }) {
    super(`Invalid scenario references: ${invalidIds.join(", ")}`);
    this.name = "InvalidScenarioReferencesError";
    this.invalidIds = invalidIds;
  }
}

/** Thrown when restoring a suite whose slug conflicts with an active suite */
export class SlugConflictError extends SuiteDomainError {
  constructor(slug: string) {
    super(`A suite with the slug "${slug}" already exists`);
    this.name = "SlugConflictError";
  }
}

/** Thrown when a suite references targets that do not exist */
export class InvalidTargetReferencesError extends SuiteDomainError {
  readonly invalidIds: string[];

  constructor({ invalidIds }: { invalidIds: string[] }) {
    super(`Invalid target references: ${invalidIds.join(", ")}`);
    this.name = "InvalidTargetReferencesError";
    this.invalidIds = invalidIds;
  }
}
