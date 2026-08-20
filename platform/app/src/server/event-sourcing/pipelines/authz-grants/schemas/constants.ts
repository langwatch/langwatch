/**
 * The authorization pipeline's two aggregates (ADR-110).
 *
 * The organization is the TENANT of every event — the isolation and routing
 * boundary, what the ClickHouse client resolver places and what tenant
 * ordering keys on. It is the AGGREGATE of nothing.
 *
 *   authz_grant  aggregateId = grantId   one grant's lifecycle
 *   authz_role   aggregateId = roleId    one role definition's lifecycle
 *
 * ADR-092 §13 put everything on one aggregate per organization, citing the
 * billing_report precedent — a pipeline whose handler returns `[]` on every
 * path and therefore never appends, so its state is permanently empty and the
 * shape's unboundedness could not show. Here it did: one aggregate's state
 * became every grant the organization had ever held, reloaded in full on
 * every batch.
 *
 * Rollout state is NOT here. The migration's own status is the read fork
 * (ADR-110: finishing the migration is the switch), so there is no cutover
 * event, no cutover projection and no gate — and nothing in this pipeline
 * knows the rollout exists.
 *
 * Checks never read the event log — they read the Postgres projections.
 */

export const AUTHZ_GRANT_PIPELINE_NAME = "authz_grant" as const;
export const AUTHZ_GRANT_AGGREGATE_TYPE = "authz_grant" as const;

export const AUTHZ_ROLE_PIPELINE_NAME = "authz_role" as const;
export const AUTHZ_ROLE_AGGREGATE_TYPE = "authz_role" as const;

// ── authz_grant ─────────────────────────────────────────────────────────
// Every command names exactly ONE grant, because a command may not straddle
// aggregates. The batched writes of ADR-092 are gone.

export const ATTACH_GRANT_COMMAND_TYPE = "lw.authz_grant.attach" as const;
export const CHANGE_GRANT_ROLE_COMMAND_TYPE =
  "lw.authz_grant.change_role" as const;
export const REVOKE_GRANT_COMMAND_TYPE = "lw.authz_grant.revoke" as const;

export const AUTHZ_GRANT_COMMAND_TYPES = [
  ATTACH_GRANT_COMMAND_TYPE,
  CHANGE_GRANT_ROLE_COMMAND_TYPE,
  REVOKE_GRANT_COMMAND_TYPE,
] as const;

export const GRANT_ATTACHED_EVENT_TYPE = "lw.authz.grant.attached" as const;
export const GRANT_ROLE_CHANGED_EVENT_TYPE =
  "lw.authz.grant.role_changed" as const;
export const GRANT_REVOKED_EVENT_TYPE = "lw.authz.grant.revoked" as const;

export const AUTHZ_GRANT_EVENT_TYPES = [
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
] as const;

// ── authz_role ──────────────────────────────────────────────────────────
// A role is an entity with its own lifecycle and its own referents (every
// custom grant's `custom:<id>` roleKey). It is few in number, which is a
// fact about size and not a reason to share a boundary with anything else.

export const DEFINE_ROLE_COMMAND_TYPE = "lw.authz_role.define" as const;
export const CHANGE_ROLE_PERMISSIONS_COMMAND_TYPE =
  "lw.authz_role.change_permissions" as const;
export const DELETE_ROLE_COMMAND_TYPE = "lw.authz_role.delete" as const;

export const AUTHZ_ROLE_COMMAND_TYPES = [
  DEFINE_ROLE_COMMAND_TYPE,
  CHANGE_ROLE_PERMISSIONS_COMMAND_TYPE,
  DELETE_ROLE_COMMAND_TYPE,
] as const;

export const ROLE_DEFINED_EVENT_TYPE = "lw.authz.role.defined" as const;
export const ROLE_PERMISSIONS_CHANGED_EVENT_TYPE =
  "lw.authz.role.permissions_changed" as const;
export const ROLE_DELETED_EVENT_TYPE = "lw.authz.role.deleted" as const;

export const AUTHZ_ROLE_EVENT_TYPES = [
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
] as const;

/** Every authorization command and event, for the type-identifier registry. */
export const AUTHZ_GRANTS_COMMAND_TYPES = [
  ...AUTHZ_GRANT_COMMAND_TYPES,
  ...AUTHZ_ROLE_COMMAND_TYPES,
] as const;

export const AUTHZ_GRANTS_EVENT_TYPES = [
  ...AUTHZ_GRANT_EVENT_TYPES,
  ...AUTHZ_ROLE_EVENT_TYPES,
] as const;

export const AUTHZ_GRANTS_EVENT_VERSION_LATEST = "2026-08-20" as const;

/** Stable verb prefix for the pipeline's audit-log `action` column, shared
 *  by the insert-only subscriber (a migrated organization) and the writer's
 *  legacy audit calls (an unmigrated one) — the same vocabulary either way. */
export const AUTHZ_AUDIT_ACTION_PREFIX = "authz.grants." as const;

/**
 * The audit verb vocabulary, shared by the subscriber's event-to-verb map
 * (`authzAuditTrail.subscriber.ts`) and the writer's legacy audit calls
 * (`recordLegacyAudit`, for organizations not yet migrated). Both write
 * `${AUTHZ_AUDIT_ACTION_PREFIX}${verb}` into the same `action` column, so a
 * verb invented on one side and not the other would silently fork the
 * vocabulary a migrated organization's history reads back against. A plain
 * union, not a Zod schema: these strings never arrive as external input.
 *
 * `offboard` is gone with ADR-110 — offboarding states one revocation per
 * grant, so the trail records revocations and nothing has to agree on a
 * second spelling of the same event.
 */
export const AUTHZ_AUDIT_VERBS = [
  "attach",
  "role_change",
  "revoke",
  "role_defined",
  "role_permissions_changed",
  "role_deleted",
] as const;

export type AuthzAuditVerb = (typeof AUTHZ_AUDIT_VERBS)[number];
