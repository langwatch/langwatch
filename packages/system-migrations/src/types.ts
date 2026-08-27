/**
 * The per-tenant state machine for one in-place migration
 * (specs/migration/system-migrations-runner.feature):
 *
 *   pending ──► migrated ──► finalized ──► rolled_back
 *     │             ▲                          (operator only)
 *     │             │ proof failed - work done, held on the legacy path
 *     └──► parked ──┘ errored - retried on a later pass
 *
 * "Pending" is the absence of a record. Every stored status is re-entrant
 * except `finalized`, which is the one-way latch consumers key behaviour
 * changes on: a migration's legacy path may only be switched off for a
 * tenant whose record says finalized.
 *
 * `rolled_back` is the operator's undo, and the only status the runner will
 * not act on. Blanking a finalized row, or moving it back to `migrated`,
 * does NOT roll a tenant back: the next pass re-runs a migration whose proof
 * still passes and re-finalizes it within minutes. Writing `rolled_back`
 * both returns the tenant to its legacy path (no consumer reads it as
 * finalized) and pins it there until a human moves it again.
 */
export type TenantMigrationStatus = "migrated" | "finalized" | "parked" | "rolled_back";

/**
 * The two terminal states the runner never re-runs: `finalized` is the
 * one-way latch and `rolled_back` is the operator's pin. One predicate, so
 * the runner and any harness composing a pass around the same state table
 * can never drift onto different skip rules.
 */
export function isTerminalTenantStatus(
  status: TenantMigrationStatus | undefined,
): boolean {
  return status === "finalized" || status === "rolled_back";
}

export type TenantMigrationRecord = {
  migrationName: string;
  tenantId: string;
  status: TenantMigrationStatus;
  /** The migration's own evidence: parity diffs for a held tenant, the
   *  error for a parked one, counts for a finalized one. Shape is owned by
   *  the migration that wrote it. */
  report: unknown;
};

/**
 * What one pass over one tenant concluded.
 *
 * `migrated` is the held state: the work is done (and idempotent to redo)
 * but the migration's own proof found disagreements, so the tenant must
 * stay on its legacy path. The runner stores the report and re-runs the
 * tenant on later passes - a held tenant heals itself once whatever the
 * report names is fixed.
 */
export type TenantMigrationOutcome =
  | { status: "finalized"; report?: unknown }
  | { status: "migrated"; report: unknown }
  | { status: "parked"; report: unknown };

export type MigrationPassSummary = {
  tenantsSeen: number;
  finalized: number;
  held: number;
  parked: number;
  /** Outside the cohort, or an operator's mid-pass pin discarded the
   *  outcome. Never "already done" - that is `alreadyFinalized` /
   *  `alreadyRolledBack`. */
  skipped: number;
  /** Finalized BEFORE this pass ever touched the tenant. Split from
   *  `skipped` so a targeted run over tenants that are all already done
   *  reads as done, not as "nothing was in the cohort". */
  alreadyFinalized: number;
  /** Rolled back (the operator's pin) BEFORE this pass ever touched the
   *  tenant. Kept apart from `alreadyFinalized` so an organization whose
   *  members were rolled back never reads as a successful finalization. */
  alreadyRolledBack: number;
  /** Claimed by another process's pass, so left to that process. */
  claimed: number;
  /**
   * State TRANSITIONS this pass made: a (tenant, migration) whose stored
   * status is not the one it carried when the pass read it, first record
   * included. The ONLY field that means the fleet moved.
   *
   * None of the others can carry that meaning, which is why this exists.
   * `held` counts a `migrated` write, and a held tenant is re-proved and
   * re-written `migrated` on every pass forever - so a caller that read
   * `held > 0` as progress would drive passes until something else stopped
   * it. `parked` has the same shape for a tenant that keeps failing the
   * same way. `tenantsSeen` counts visits, not outcomes. Zero here is the
   * honest "this pass changed nothing, and running another identical one
   * will change nothing either".
   */
  advanced: number;
};
