import { HandledError } from "@langwatch/handled-error";

/**
 * Rolling an organization back to its legacy path is an operator action with
 * one precondition: the organization must already be on the ledger -
 * `migrated` (held, parity still disagreeing) or `finalized` (parity clean).
 * Both are already live on ledger writes (ledger-write-gate.ts), so both are
 * the operator's to pull back; anything else either never reached the
 * ledger or is already rolled back. Every other status is a caller mistake
 * the operator can act on, so both failures are handled errors, not 500s
 * (specs/rbac/in-place-authz-migration.feature, "An operator rolls a
 * finalized organization back to its legacy path", "An operator rolls a
 * migrated organization back to its legacy path").
 */

export class MigrationStateNotFoundError extends HandledError {
  declare readonly code: "migration_state_not_found";

  constructor() {
    super(
      "migration_state_not_found",
      "No migration state exists for that organization",
      { httpStatus: 404, fault: "customer" },
    );
    this.name = "MigrationStateNotFoundError";
  }
}

export class MigrationRollbackRequiresMigratedOrFinalizedError extends HandledError {
  declare readonly code: "migration_rollback_requires_migrated_or_finalized";

  constructor({ status }: { status: string }) {
    super(
      "migration_rollback_requires_migrated_or_finalized",
      "Only a migrated or finalized organization can be rolled back",
      // meta.status is read by the presentation registry's describe() to
      // tell the operator which state the organization is actually in.
      { httpStatus: 409, fault: "customer", meta: { status } },
    );
    this.name = "MigrationRollbackRequiresMigratedOrFinalizedError";
  }
}
