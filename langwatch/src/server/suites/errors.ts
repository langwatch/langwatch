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

/** Thrown when a suite references targets that do not exist */
export class InvalidTargetReferencesError extends SuiteDomainError {
  readonly invalidIds: string[];

  constructor({ invalidIds }: { invalidIds: string[] }) {
    super(`Invalid target references: ${invalidIds.join(", ")}`);
    this.name = "InvalidTargetReferencesError";
    this.invalidIds = invalidIds;
  }
}

/** Thrown when all scenarios in a suite are archived */
export class AllScenariosArchivedError extends SuiteDomainError {
  constructor() {
    super("All scenarios in this suite are archived. Update the suite to include active scenarios.");
    this.name = "AllScenariosArchivedError";
  }
}

/** Thrown when all targets in a suite are archived */
export class AllTargetsArchivedError extends SuiteDomainError {
  constructor() {
    super("All targets in this suite are archived. Update the suite to include active targets.");
    this.name = "AllTargetsArchivedError";
  }
}
