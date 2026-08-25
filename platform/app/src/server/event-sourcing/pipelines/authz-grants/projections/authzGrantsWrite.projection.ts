/**
 * The authorization read model, written straight from the log.
 *
 * This is a projection that never reads. Every authz event carries everything
 * needed to apply it to exactly one row, so there is no prior state to load,
 * no fold, and no cursor table — which is what the fold this replaces got
 * wrong: keyed by organization, its `load()` read every grant the org held on
 * every batch, so an import decelerated as it grew (ADR-110).
 *
 * `map()` returns a WRITE, not a row. Some events state a whole grant
 * (`attached`, `defined`), others state one field of one (`role_changed`,
 * `revoked`). The store below turns each into a single guarded statement.
 *
 * Two properties make it safe without a cursor:
 *
 *   - Every write is state-setting, never incremental. Re-applying any event
 *     is a no-op, so at-least-once redelivery cannot corrupt a row.
 *   - A revoke MARKS its row rather than deleting it, and every write is
 *     guarded on `occurredAt`. A late redelivery of an older event therefore
 *     loses to the newer state that is already there, instead of resurrecting
 *     a grant that no row was left to contradict.
 */
import {
  type GrantRowShape,
  PRINCIPAL_TO_DB,
  RESOURCE_KIND_TO_DB,
  type RoleRowShape,
} from "@langwatch/authz-server";
import type { MapEventHandlers } from "../../../projections/abstractMapProjection";
import { AbstractMapProjection } from "../../../projections/abstractMapProjection";
import type { AppendStore } from "../../../projections/mapProjection.types";
import {
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
} from "../schemas/constants";
import {
  type GrantAttachedEvent,
  type GrantRevokedEvent,
  type GrantRoleChangedEvent,
  grantAttachedEventSchema,
  grantRevokedEventSchema,
  grantRoleChangedEventSchema,
  type RoleDefinedEvent,
  type RoleDeletedEvent,
  type RolePermissionsChangedEvent,
  roleDefinedEventSchema,
  roleDeletedEventSchema,
  rolePermissionsChangedEventSchema,
} from "../schemas/events";

/**
 * One statement about one row. Named for what it is rather than `Record`:
 * only two of the six carry a whole row, and the rest name a field.
 *
 * `occurredAt` is on every one of them because it is the guard, not
 * decoration — the store refuses a write whose event is older than the row.
 */
export type GrantProjectionWrite =
  | { kind: "grant.upsert"; row: GrantRowShape }
  | {
      kind: "grant.setRole";
      grantId: string;
      roleKey: string;
      occurredAt: Date;
    }
  | {
      kind: "grant.revoke";
      grantId: string;
      reason: string | null;
      occurredAt: Date;
    }
  | { kind: "role.upsert"; row: RoleRowShape }
  | {
      kind: "role.setPermissions";
      roleId: string;
      permissions: string[];
      occurredAt: Date;
    }
  | { kind: "role.delete"; roleId: string; occurredAt: Date };

export type GrantProjectionWriteStore = AppendStore<GrantProjectionWrite>;

const authzGrantsEvents = [
  grantAttachedEventSchema,
  grantRoleChangedEventSchema,
  grantRevokedEventSchema,
  roleDefinedEventSchema,
  rolePermissionsChangedEventSchema,
  roleDeletedEventSchema,
] as const;

export const AUTHZ_GRANTS_WRITE_PROJECTION_NAME = "authzGrantsWrite" as const;

export class AuthzGrantsWriteProjection
  extends AbstractMapProjection<GrantProjectionWrite, typeof authzGrantsEvents>
  implements MapEventHandlers<typeof authzGrantsEvents, GrantProjectionWrite>
{
  readonly name = AUTHZ_GRANTS_WRITE_PROJECTION_NAME;
  readonly store: GrantProjectionWriteStore;

  protected readonly events = authzGrantsEvents;

  constructor(deps: { store: GrantProjectionWriteStore }) {
    super();
    this.store = deps.store;
  }

  mapAuthzGrantAttached(event: GrantAttachedEvent): GrantProjectionWrite {
    const { data } = event;
    return {
      kind: "grant.upsert",
      row: {
        id: data.grantId,
        // The organization is the event's TENANT (ADR-110): the aggregate is
        // the grant, so the owning org can only come from the envelope.
        organizationId: event.tenantId,
        principalType: PRINCIPAL_TO_DB[data.principal.type],
        principalId: data.principal.id,
        roleKey: data.roleKey,
        legacyRole: data.legacyRole ?? null,
        source: data.source,
        scopeType: data.scope.type,
        scopeId: data.scope.id,
        token: data.resource?.token ?? null,
        permission: data.resource?.permission ?? null,
        resourceKind: data.resource
          ? RESOURCE_KIND_TO_DB[data.resource.kind]
          : null,
        projectId: data.resource?.projectId ?? null,
        createdByUserId: data.resource?.createdByUserId ?? null,
        // One column, two tiers, and they are mutually exclusive by the
        // event's own shape refinement: a RESOURCE grant states its expiry
        // inside its terms, every other tier states it on the grant. An
        // event carrying neither - which is every event appended before
        // expiring bindings existed - lands null, exactly as it always did.
        expiresAt: expiryFrom(data.resource?.expiresAtMs ?? data.expiresAtMs),
        maxViews: data.resource?.maxViews ?? null,
        occurredAt: new Date(event.occurredAt),
      },
    };
  }

  /**
   * Reassigning the role also clears `legacyRole`.
   *
   * That column is the `role` an IMPORTED binding carried alongside a
   * `custom:<id>` roleKey, and the compat row reads
   * `role = legacyRole ?? "CUSTOM"`. Leaving it behind after a reassignment
   * made an adopted ADMIN binding moved to a new custom role project as
   * role=ADMIN, and the legacy resolver's empty-permission-list fallback then
   * answered "admin" where the legacy row said "viewer". Once a grant has
   * been reassigned it is no longer the binding that was imported, so the
   * column stops describing it.
   */
  mapAuthzGrantRoleChanged(event: GrantRoleChangedEvent): GrantProjectionWrite {
    return {
      kind: "grant.setRole",
      grantId: event.data.grantId,
      roleKey: event.data.to,
      occurredAt: new Date(event.occurredAt),
    };
  }

  mapAuthzGrantRevoked(event: GrantRevokedEvent): GrantProjectionWrite {
    return {
      kind: "grant.revoke",
      grantId: event.data.grantId,
      reason: event.data.reason ?? null,
      occurredAt: new Date(event.occurredAt),
    };
  }

  mapAuthzRoleDefined(event: RoleDefinedEvent): GrantProjectionWrite {
    const { data } = event;
    return {
      kind: "role.upsert",
      row: {
        id: data.roleId,
        organizationId: event.tenantId,
        name: data.name,
        description: data.description ?? null,
        permissions: data.permissions,
        kind: data.kind,
        occurredAt: new Date(event.occurredAt),
      },
    };
  }

  mapAuthzRolePermissionsChanged(
    event: RolePermissionsChangedEvent,
  ): GrantProjectionWrite {
    return {
      kind: "role.setPermissions",
      roleId: event.data.roleId,
      permissions: [...event.data.permissions],
      occurredAt: new Date(event.occurredAt),
    };
  }

  mapAuthzRoleDeleted(event: RoleDeletedEvent): GrantProjectionWrite {
    return {
      kind: "role.delete",
      roleId: event.data.roleId,
      occurredAt: new Date(event.occurredAt),
    };
  }
}

/** A ledger expiry as the projection column holds it. */
function expiryFrom(expiresAtMs: number | undefined): Date | null {
  return expiresAtMs != null ? new Date(expiresAtMs) : null;
}

export const AUTHZ_GRANTS_WRITE_EVENT_TYPES = [
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
] as const;
