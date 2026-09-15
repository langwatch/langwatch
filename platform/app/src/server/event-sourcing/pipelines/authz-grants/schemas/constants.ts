// ADR-110. Two aggregates, both keyed by the entity their events are about:
// what separates a grant's fold from a role's is the aggregate ID its command
// stamps, which is the whole point of the split. The organization is the
// tenant of every event and the aggregate of nothing. Rollout state is not
// here: the migration's status is the read fork.
//
// ONE aggregate TYPE for both families, and it is not cosmetic. The type is
// the storage partition key (`domain/aggregateType.ts`: "events are
// partitioned by tenantId + aggregateType") and the event store rejects, at
// append, any event whose type differs from the one its pipeline declares.
// Both families ride the `authz_grant` pipeline, so both stamp its type; a
// separate `authz_role` type would have to come with a pipeline of its own.
export const AUTHZ_GRANT_PIPELINE_NAME = "authz_grant" as const;
export const AUTHZ_GRANT_AGGREGATE_TYPE = "authz_grant" as const;

// Each command names one grant; a command may not straddle aggregates.
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

// The third family, and it rides the same pipeline for the same reason the
// role family does (ADR-110): the aggregate TYPE is the storage partition key
// and the event store refuses any event whose type differs from the one its
// pipeline declares, so a `authz_group_member` type would need a pipeline of
// its own. What separates a membership's fold from a grant's is the aggregate
// ID its command stamps - a membership id.
//
// A membership is org-scoped because the group is, so `tenantId ===
// organizationId` holds here exactly as it does for a grant command.
export const ADD_GROUP_MEMBER_COMMAND_TYPE =
  "lw.authz_group_member.add" as const;
export const REMOVE_GROUP_MEMBER_COMMAND_TYPE =
  "lw.authz_group_member.remove" as const;

export const AUTHZ_GROUP_MEMBER_COMMAND_TYPES = [
  ADD_GROUP_MEMBER_COMMAND_TYPE,
  REMOVE_GROUP_MEMBER_COMMAND_TYPE,
] as const;

export const GROUP_MEMBER_ADDED_EVENT_TYPE =
  "lw.authz.group_member.added" as const;
export const GROUP_MEMBER_REMOVED_EVENT_TYPE =
  "lw.authz.group_member.removed" as const;

export const AUTHZ_GROUP_MEMBER_EVENT_TYPES = [
  GROUP_MEMBER_ADDED_EVENT_TYPE,
  GROUP_MEMBER_REMOVED_EVENT_TYPE,
] as const;

export const AUTHZ_GRANTS_COMMAND_TYPES = [
  ...AUTHZ_GRANT_COMMAND_TYPES,
  ...AUTHZ_ROLE_COMMAND_TYPES,
  ...AUTHZ_GROUP_MEMBER_COMMAND_TYPES,
] as const;

export const AUTHZ_GRANTS_EVENT_TYPES = [
  ...AUTHZ_GRANT_EVENT_TYPES,
  ...AUTHZ_ROLE_EVENT_TYPES,
  ...AUTHZ_GROUP_MEMBER_EVENT_TYPES,
] as const;

export const AUTHZ_GRANTS_EVENT_VERSION_LATEST = "2026-08-20" as const;

export const AUTHZ_AUDIT_ACTION_PREFIX = "authz.grants." as const;

// Shared by the audit subscriber and the pre-migration writer, which both
// write `${AUTHZ_AUDIT_ACTION_PREFIX}${verb}` into the same column.
export const AUTHZ_AUDIT_VERBS = [
  "attach",
  "role_change",
  "revoke",
  "role_defined",
  "role_permissions_changed",
  "role_deleted",
  "group_member_added",
  "group_member_removed",
] as const;

export type AuthzAuditVerb = (typeof AUTHZ_AUDIT_VERBS)[number];
