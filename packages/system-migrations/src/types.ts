/**
 * The per-tenant migration state: `finalized` is a one-way latch consumers
 * key legacy-path removal on. Blanking a finalized row does NOT roll it
 * back — re-proving just re-finalizes it; only `rolled_back` pins it on legacy.
 */
export const TENANT_MIGRATION_STATUSES = [
  "migrated",
  "finalized",
  "parked",
  "rolled_back",
] as const;

export type TenantMigrationStatus = (typeof TENANT_MIGRATION_STATUSES)[number];

/**
 * The two terminal states the runner never re-runs: `finalized`, the one-way
 * latch, and `rolled_back`, the operator's pin. One predicate so no harness
 * composing a pass drifts onto a different skip rule.
 */
export function isTerminalTenantStatus(status: TenantMigrationStatus | undefined): boolean {
  return status === "finalized" || status === "rolled_back";
}

/**
 * The same two statuses as a LIST, for a `status = ANY(...)` SQL narrowing.
 * Derived from `isTerminalTenantStatus`, not written out again.
 */
export const TERMINAL_TENANT_STATUSES: readonly TenantMigrationStatus[] =
  TENANT_MIGRATION_STATUSES.filter(isTerminalTenantStatus);

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
 * What one pass over one tenant concluded. `migrated` is the held state:
 * work is done but the migration's own proof found disagreements, so the
 * tenant stays on its legacy path until a later pass's proof passes.
 */
export type TenantMigrationOutcome =
  | { status: "finalized"; report?: unknown }
  | { status: "migrated"; report: unknown }
  | { status: "parked"; report: unknown };

export type MigrationPassSummary = {
  tenantsSeen: number;
  finalized: number;
  held: number;
  /** Held outcomes from migrations that must settle before startup. */
  finiteHeld?: number;
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
   * State TRANSITIONS this pass made — the ONLY field that means the fleet
   * moved. `held`/`parked` re-count every pass forever, so reading `held > 0`
   * as progress loops forever. Zero here honestly means nothing changed, and won't.
   */
  advanced: number;
};
