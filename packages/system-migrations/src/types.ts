/**
 * The per-tenant state machine for one in-place migration
 * (specs/rbac/in-place-authz-migration.feature):
 *
 *   pending ──► migrated ──► finalized
 *     │             ▲
 *     │             │ proof failed - work done, held on the legacy path
 *     └──► parked ──┘ errored - retried on a later pass
 *
 * "Pending" is the absence of a record. Every stored status is re-entrant
 * except `finalized`, which is the one-way latch consumers key behaviour
 * changes on: a migration's legacy path may only be switched off for a
 * tenant whose record says finalized.
 */
export type TenantMigrationStatus = "migrated" | "finalized" | "parked";

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
  /** Already finalized before this pass, or outside the cohort. */
  skipped: number;
};
