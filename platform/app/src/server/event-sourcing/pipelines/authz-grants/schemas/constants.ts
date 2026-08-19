export const AUTHZ_GRANTS_PIPELINE_NAME = "authz_grants" as const;
export const AUTHZ_GRANTS_AGGREGATE_TYPE = "authz_grants" as const;

/**
 * The grants ledger (ADR-092 §13). One aggregate per organization
 * (`aggregateId = organizationId`, the billing_report precedent). The
 * runtime family records one access fact per event; the process family
 * records the cutover machine's own facts. Checks never read these —
 * they read the Postgres projections the fold maintains.
 */

export const ATTACH_GRANTS_COMMAND_TYPE =
  "lw.authz_grants.attach_grants" as const;
export const PROVE_MIGRATION_PARITY_COMMAND_TYPE =
  "lw.authz_grants.prove_migration_parity" as const;
export const COMPLETE_CUTOVER_COMMAND_TYPE =
  "lw.authz_grants.complete_cutover" as const;
export const ROLL_BACK_CUTOVER_COMMAND_TYPE =
  "lw.authz_grants.roll_back_cutover" as const;
export const RECORD_MIGRATION_TENANT_STATE_COMMAND_TYPE =
  "lw.authz_grants.record_migration_tenant_state" as const;

export const AUTHZ_GRANTS_COMMAND_TYPES = [
  ATTACH_GRANTS_COMMAND_TYPE,
  PROVE_MIGRATION_PARITY_COMMAND_TYPE,
  COMPLETE_CUTOVER_COMMAND_TYPE,
  ROLL_BACK_CUTOVER_COMMAND_TYPE,
  RECORD_MIGRATION_TENANT_STATE_COMMAND_TYPE,
] as const;

// Runtime family — one access fact each.
export const GRANT_ATTACHED_EVENT_TYPE =
  "lw.authz.grants.grant_attached" as const;
export const GRANT_ROLE_CHANGED_EVENT_TYPE =
  "lw.authz.grants.grant_role_changed" as const;
export const GRANT_REVOKED_EVENT_TYPE =
  "lw.authz.grants.grant_revoked" as const;
export const ROLE_DEFINED_EVENT_TYPE = "lw.authz.grants.role_defined" as const;
export const ROLE_PERMISSIONS_CHANGED_EVENT_TYPE =
  "lw.authz.grants.role_permissions_changed" as const;
export const ROLE_DELETED_EVENT_TYPE = "lw.authz.grants.role_deleted" as const;
export const MEMBER_OFFBOARDED_EVENT_TYPE =
  "lw.authz.grants.member_offboarded" as const;

// Process family — the cutover machine's own facts.
export const MIGRATION_PARITY_PROVED_EVENT_TYPE =
  "lw.authz.grants.migration_parity_proved" as const;
export const CUTOVER_COMPLETED_EVENT_TYPE =
  "lw.authz.grants.cutover_completed" as const;
export const CUTOVER_ROLLED_BACK_EVENT_TYPE =
  "lw.authz.grants.cutover_rolled_back" as const;
/** The runner's lifecycle transitions as witness facts: the state table's
 *  synchronous write stays the latch; this event makes the transition
 *  replayable and auditable. */
export const MIGRATION_TENANT_STATE_CHANGED_EVENT_TYPE =
  "lw.authz.grants.migration_tenant_state_changed" as const;

export const AUTHZ_GRANTS_EVENT_TYPES = [
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
  MEMBER_OFFBOARDED_EVENT_TYPE,
  MIGRATION_PARITY_PROVED_EVENT_TYPE,
  CUTOVER_COMPLETED_EVENT_TYPE,
  CUTOVER_ROLLED_BACK_EVENT_TYPE,
  MIGRATION_TENANT_STATE_CHANGED_EVENT_TYPE,
] as const;

export const AUTHZ_GRANTS_EVENT_VERSION_LATEST = "2026-08-17" as const;
