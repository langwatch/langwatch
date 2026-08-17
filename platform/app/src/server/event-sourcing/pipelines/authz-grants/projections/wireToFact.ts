import type { GrantsLedgerEvent } from "@langwatch/authz-server";
import {
  CUTOVER_COMPLETED_EVENT_TYPE,
  CUTOVER_ROLLED_BACK_EVENT_TYPE,
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  MEMBER_OFFBOARDED_EVENT_TYPE,
  MIGRATION_PARITY_PROVED_EVENT_TYPE,
  MIGRATION_TENANT_STATE_CHANGED_EVENT_TYPE,
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
} from "../schemas/constants";
import type { AuthzGrantsEvent } from "../schemas/events";

/**
 * Wire event → the pure reducer's fact shape. Time crosses here: the
 * envelope's `occurredAt` (business time) becomes the fact's `occurredAtMs`.
 * The reducer in `@langwatch/authz-server` is the ONLY state-transition
 * logic; this file only reshapes.
 *
 * An event type outside this aggregate throws — the projection must fail
 * loudly rather than silently skip a fact.
 */
export function wireEventToFact(event: AuthzGrantsEvent): GrantsLedgerEvent {
  switch (event.type) {
    case GRANT_ATTACHED_EVENT_TYPE:
    case GRANT_ROLE_CHANGED_EVENT_TYPE:
    case GRANT_REVOKED_EVENT_TYPE:
      return grantEventToFact(event);
    case ROLE_DEFINED_EVENT_TYPE:
    case ROLE_PERMISSIONS_CHANGED_EVENT_TYPE:
    case ROLE_DELETED_EVENT_TYPE:
      return roleEventToFact(event);
    case MEMBER_OFFBOARDED_EVENT_TYPE:
      return {
        kind: "member_offboarded",
        userId: event.data.userId,
        revokedGrantIds: event.data.revokedGrantIds,
        actor: event.data.actor,
        occurredAtMs: event.occurredAt,
      };
    case MIGRATION_PARITY_PROVED_EVENT_TYPE:
      return {
        kind: "migration_parity_proved",
        diffs: event.data.diffs,
        occurredAtMs: event.occurredAt,
      };
    case CUTOVER_COMPLETED_EVENT_TYPE:
      return {
        kind: "cutover_completed",
        actor: event.data.actor,
        occurredAtMs: event.occurredAt,
      };
    case CUTOVER_ROLLED_BACK_EVENT_TYPE:
      return {
        kind: "cutover_rolled_back",
        ...(event.data.reason ? { reason: event.data.reason } : {}),
        actor: event.data.actor,
        occurredAtMs: event.occurredAt,
      };
    case MIGRATION_TENANT_STATE_CHANGED_EVENT_TYPE:
      return {
        kind: "migration_tenant_state_changed",
        migrationName: event.data.migrationName,
        status: event.data.status,
        ...(event.data.report == null ? {} : { report: event.data.report }),
        actor: event.data.actor,
        occurredAtMs: event.occurredAt,
      };
  }
}

type GrantFamilyEvent = Extract<
  AuthzGrantsEvent,
  {
    type:
      | typeof GRANT_ATTACHED_EVENT_TYPE
      | typeof GRANT_ROLE_CHANGED_EVENT_TYPE
      | typeof GRANT_REVOKED_EVENT_TYPE;
  }
>;

function grantEventToFact(event: GrantFamilyEvent): GrantsLedgerEvent {
  switch (event.type) {
    case GRANT_ATTACHED_EVENT_TYPE:
      return {
        kind: "grant_attached",
        grant: {
          grantId: event.data.grantId,
          principal: event.data.principal,
          roleKey: event.data.roleKey,
          scope: event.data.scope,
          ...(event.data.resource ? { resource: event.data.resource } : {}),
          source: event.data.source,
          occurredAtMs: event.occurredAt,
        },
        actor: event.data.actor,
      };
    case GRANT_ROLE_CHANGED_EVENT_TYPE:
      return {
        kind: "grant_role_changed",
        grantId: event.data.grantId,
        from: event.data.from,
        to: event.data.to,
        actor: event.data.actor,
        occurredAtMs: event.occurredAt,
      };
    case GRANT_REVOKED_EVENT_TYPE:
      return {
        kind: "grant_revoked",
        grantId: event.data.grantId,
        ...(event.data.reason ? { reason: event.data.reason } : {}),
        actor: event.data.actor,
        occurredAtMs: event.occurredAt,
      };
  }
}

type RoleFamilyEvent = Extract<
  AuthzGrantsEvent,
  {
    type:
      | typeof ROLE_DEFINED_EVENT_TYPE
      | typeof ROLE_PERMISSIONS_CHANGED_EVENT_TYPE
      | typeof ROLE_DELETED_EVENT_TYPE;
  }
>;

function roleEventToFact(event: RoleFamilyEvent): GrantsLedgerEvent {
  switch (event.type) {
    case ROLE_DEFINED_EVENT_TYPE:
      return {
        kind: "role_defined",
        role: {
          roleId: event.data.roleId,
          name: event.data.name,
          ...(event.data.description
            ? { description: event.data.description }
            : {}),
          permissions: event.data.permissions,
          kind: event.data.kind,
          occurredAtMs: event.occurredAt,
        },
        actor: event.data.actor,
      };
    case ROLE_PERMISSIONS_CHANGED_EVENT_TYPE:
      return {
        kind: "role_permissions_changed",
        roleId: event.data.roleId,
        permissions: event.data.permissions,
        actor: event.data.actor,
        occurredAtMs: event.occurredAt,
      };
    case ROLE_DELETED_EVENT_TYPE:
      return {
        kind: "role_deleted",
        roleId: event.data.roleId,
        actor: event.data.actor,
        occurredAtMs: event.occurredAt,
      };
  }
}
