import {
  AUTHZ_GRANTS_EVENT_TYPES,
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
} from "@langwatch/authz-contract";
import type {
  AppendStore,
  BulkAppendContext,
  MapProjectionDefinition,
  ProjectionStoreContext,
} from "@langwatch/eventing";
import {
  type GrantRowShape,
  PRINCIPAL_TO_DB,
  RESOURCE_KIND_TO_DB,
  type RoleRowShape,
} from "../repositories/prisma/prisma.authz-grant.mapper";
import type {
  AuthzGrantsEvent,
  GrantAttachedEvent,
  GrantRevokedEvent,
  GrantRoleChangedEvent,
  RoleDefinedEvent,
  RoleDeletedEvent,
  RolePermissionsChangedEvent,
} from "../adapters/eventing.authz.adapter";

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

/** Storage port for the guarded, state-setting projection writes. */
export abstract class GrantProjectionWriteStore implements AppendStore<GrantProjectionWrite> {
  abstract append(
    write: GrantProjectionWrite,
    context: ProjectionStoreContext,
  ): Promise<void>;

  bulkAppend?(writes: GrantProjectionWrite[], context: BulkAppendContext): Promise<void>;
}

export const AUTHZ_GRANTS_WRITE_PROJECTION_NAME = "authzGrantsWrite" as const;
export const AUTHZ_GRANTS_WRITE_EVENT_TYPES = AUTHZ_GRANTS_EVENT_TYPES;

/**
 * Stateless one-event/one-write projection. Writes are guarded by occurredAt
 * in the concrete store, so replay and at-least-once delivery converge.
 */
export class AuthzGrantProjection implements MapProjectionDefinition<
  GrantProjectionWrite,
  AuthzGrantsEvent
> {
  readonly name = AUTHZ_GRANTS_WRITE_PROJECTION_NAME;
  readonly eventTypes = AUTHZ_GRANTS_WRITE_EVENT_TYPES;

  private constructor(readonly store: GrantProjectionWriteStore) {}

  static create(store: GrantProjectionWriteStore): AuthzGrantProjection {
    return new AuthzGrantProjection(store);
  }

  map(event: AuthzGrantsEvent): GrantProjectionWrite {
    switch (event.type) {
      case GRANT_ATTACHED_EVENT_TYPE:
        return this.mapAuthzGrantAttached(event);
      case GRANT_ROLE_CHANGED_EVENT_TYPE:
        return this.mapAuthzGrantRoleChanged(event);
      case GRANT_REVOKED_EVENT_TYPE:
        return this.mapAuthzGrantRevoked(event);
      case ROLE_DEFINED_EVENT_TYPE:
        return this.mapAuthzRoleDefined(event);
      case ROLE_PERMISSIONS_CHANGED_EVENT_TYPE:
        return this.mapAuthzRolePermissionsChanged(event);
      case ROLE_DELETED_EVENT_TYPE:
        return this.mapAuthzRoleDeleted(event);
    }
    throw new Error("unsupported AuthZ grant event");
  }

  mapAuthzGrantAttached(event: GrantAttachedEvent): GrantProjectionWrite {
    const { data } = event;
    return {
      kind: "grant.upsert",
      row: {
        id: data.grantId,
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
        resourceKind: data.resource ? RESOURCE_KIND_TO_DB[data.resource.kind] : null,
        projectId: data.resource?.projectId ?? null,
        createdByUserId: data.resource?.createdByUserId ?? null,
        expiresAt: data.resource?.expiresAtMs
          ? new Date(data.resource.expiresAtMs)
          : null,
        maxViews: data.resource?.maxViews ?? null,
        occurredAt: new Date(event.occurredAt),
      },
    };
  }

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
