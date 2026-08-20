/**
 * The grants ledger's two aggregates (ADR-110).
 *
 * The organization is the TENANT on both — it is the isolation and routing
 * boundary, what the ClickHouse client resolver places and what tenant
 * ordering keys on. It is no longer the AGGREGATE on either.
 *
 *   authz_grant       aggregateId = grantId          one grant's lifecycle
 *   authz_org_policy  aggregateId = organizationId   roles, cutover, migration
 *
 * ADR-092 §13 put everything on one aggregate per organization, citing the
 * billing_report precedent — a pipeline whose handler returns `[]` on every
 * path and therefore never appends, so its fold state is permanently empty
 * and the shape's unboundedness could not show. Here it did: one aggregate's
 * fold state became every grant the organization had ever held, reloaded in
 * full on every event batch.
 *
 * Checks never read these — they read the Postgres projections the folds
 * maintain.
 */

export const AUTHZ_GRANT_PIPELINE_NAME = "authz_grant" as const;
export const AUTHZ_GRANT_AGGREGATE_TYPE = "authz_grant" as const;

export const AUTHZ_ORG_POLICY_PIPELINE_NAME = "authz_org_policy" as const;
export const AUTHZ_ORG_POLICY_AGGREGATE_TYPE = "authz_org_policy" as const;

// ── authz_grant: commands ───────────────────────────────────────────────
// Every one of these names exactly ONE grant, because a command may not
// straddle aggregates. The batched `attach_grants` of ADR-092 is gone.

export const ATTACH_GRANT_COMMAND_TYPE = "lw.authz_grant.attach" as const;
export const CHANGE_GRANT_ROLE_COMMAND_TYPE =
  "lw.authz_grant.change_role" as const;
export const REVOKE_GRANT_COMMAND_TYPE = "lw.authz_grant.revoke" as const;

export const AUTHZ_GRANT_COMMAND_TYPES = [
  ATTACH_GRANT_COMMAND_TYPE,
  CHANGE_GRANT_ROLE_COMMAND_TYPE,
  REVOKE_GRANT_COMMAND_TYPE,
] as const;

// ── authz_grant: events ─────────────────────────────────────────────────

export const GRANT_ATTACHED_EVENT_TYPE = "lw.authz.grant.attached" as const;
export const GRANT_ROLE_CHANGED_EVENT_TYPE =
  "lw.authz.grant.role_changed" as const;
export const GRANT_REVOKED_EVENT_TYPE = "lw.authz.grant.revoked" as const;

export const AUTHZ_GRANT_EVENT_TYPES = [
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
] as const;

// ── authz_org_policy: commands ──────────────────────────────────────────
// Organization-wide facts: role definitions (few, rarely changed, and named
// by every custom grant's roleKey), the cutover machine, and the runner's
// own lifecycle. Offboarding records the organization-level fact; the
// revocations it implies fan out as one revoke command per grant.

export const DEFINE_ROLES_COMMAND_TYPE =
  "lw.authz_org_policy.define_roles" as const;
export const DELETE_ROLE_COMMAND_TYPE =
  "lw.authz_org_policy.delete_role" as const;
export const OFFBOARD_MEMBER_COMMAND_TYPE =
  "lw.authz_org_policy.offboard_member" as const;
export const PROVE_MIGRATION_PARITY_COMMAND_TYPE =
  "lw.authz_org_policy.prove_migration_parity" as const;
export const COMPLETE_CUTOVER_COMMAND_TYPE =
  "lw.authz_org_policy.complete_cutover" as const;
export const ROLL_BACK_CUTOVER_COMMAND_TYPE =
  "lw.authz_org_policy.roll_back_cutover" as const;
export const RECORD_MIGRATION_TENANT_STATE_COMMAND_TYPE =
  "lw.authz_org_policy.record_migration_tenant_state" as const;

export const AUTHZ_ORG_POLICY_COMMAND_TYPES = [
  DEFINE_ROLES_COMMAND_TYPE,
  DELETE_ROLE_COMMAND_TYPE,
  OFFBOARD_MEMBER_COMMAND_TYPE,
  PROVE_MIGRATION_PARITY_COMMAND_TYPE,
  COMPLETE_CUTOVER_COMMAND_TYPE,
  ROLL_BACK_CUTOVER_COMMAND_TYPE,
  RECORD_MIGRATION_TENANT_STATE_COMMAND_TYPE,
] as const;

// ── authz_org_policy: events ────────────────────────────────────────────

export const ROLE_DEFINED_EVENT_TYPE =
  "lw.authz.org_policy.role_defined" as const;
export const ROLE_PERMISSIONS_CHANGED_EVENT_TYPE =
  "lw.authz.org_policy.role_permissions_changed" as const;
export const ROLE_DELETED_EVENT_TYPE =
  "lw.authz.org_policy.role_deleted" as const;
export const MEMBER_OFFBOARDED_EVENT_TYPE =
  "lw.authz.org_policy.member_offboarded" as const;
export const MIGRATION_PARITY_PROVED_EVENT_TYPE =
  "lw.authz.org_policy.migration_parity_proved" as const;
export const CUTOVER_COMPLETED_EVENT_TYPE =
  "lw.authz.org_policy.cutover_completed" as const;
export const CUTOVER_ROLLED_BACK_EVENT_TYPE =
  "lw.authz.org_policy.cutover_rolled_back" as const;
/** The runner's lifecycle transitions as witness facts: the state table's
 *  synchronous write stays the latch; this event makes the transition
 *  replayable and auditable. */
export const MIGRATION_TENANT_STATE_CHANGED_EVENT_TYPE =
  "lw.authz.org_policy.migration_tenant_state_changed" as const;

export const AUTHZ_ORG_POLICY_EVENT_TYPES = [
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
  MEMBER_OFFBOARDED_EVENT_TYPE,
  MIGRATION_PARITY_PROVED_EVENT_TYPE,
  CUTOVER_COMPLETED_EVENT_TYPE,
  CUTOVER_ROLLED_BACK_EVENT_TYPE,
  MIGRATION_TENANT_STATE_CHANGED_EVENT_TYPE,
] as const;

/** Every authz command and event, for the type-identifier registry. */
export const AUTHZ_GRANTS_COMMAND_TYPES = [
  ...AUTHZ_GRANT_COMMAND_TYPES,
  ...AUTHZ_ORG_POLICY_COMMAND_TYPES,
] as const;

export const AUTHZ_GRANTS_EVENT_TYPES = [
  ...AUTHZ_GRANT_EVENT_TYPES,
  ...AUTHZ_ORG_POLICY_EVENT_TYPES,
] as const;

export const AUTHZ_GRANTS_EVENT_VERSION_LATEST = "2026-08-20" as const;

/** Stable verb prefix for the pipeline's audit-log `action` column, shared
 *  by the insert-only subscriber (a migrated organization) and the ledger
 *  writer's `recordLegacyAudit` (an unmigrated one) — the same action
 *  vocabulary either way. */
export const AUTHZ_AUDIT_ACTION_PREFIX = "authz.grants." as const;

/**
 * The audit verb vocabulary, shared by the subscriber's event-to-verb map
 * (`authzAuditTrail.subscriber.ts`) and the ledger writer's legacy audit
 * calls (`recordLegacyAudit` in `ledger.ts`, for organizations not yet on
 * the ledger). Both write `${AUTHZ_AUDIT_ACTION_PREFIX}${verb}` into the
 * same `action` column, so a verb invented on one side and not the other
 * would silently fork the vocabulary a migrated organization's history
 * reads back against. A plain union, not a Zod schema: these strings never
 * arrive as external input, so there is nothing here to validate.
 */
export const AUTHZ_AUDIT_VERBS = [
  "attach",
  "role_change",
  "revoke",
  "role_defined",
  "role_permissions_changed",
  "role_deleted",
  "offboard",
] as const;

export type AuthzAuditVerb = (typeof AUTHZ_AUDIT_VERBS)[number];
