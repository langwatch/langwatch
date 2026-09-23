import {
  AUTHZ_GRANTS_EVENT_TYPES,
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
} from "@langwatch/authz-contract";
import type { MapProjectionDefinition } from "@langwatch/eventing";
import { Temporal } from "@langwatch/time";

import type {
  GrantProjectionWrite,
  AuthzGrantProjectionRepository,
} from "../repositories/authz-grant-projection.repository.ts";
import {
  PRINCIPAL_TO_DB,
  RESOURCE_KIND_TO_DB,
} from "../repositories/prisma/prisma.authz-grant.mapper.ts";
import type {
  AuthzGrantsEvent,
  GrantAttachedEvent,
  GrantRevokedEvent,
  GrantRoleChangedEvent,
  RoleDefinedEvent,
  RoleDeletedEvent,
  RolePermissionsChangedEvent,
} from "./authz-grant.events.ts";

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

  private constructor(readonly store: AuthzGrantProjectionRepository) {}

  static create(store: AuthzGrantProjectionRepository): AuthzGrantProjection {
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
      ...(data.membershipStamp ? { membershipStamp: data.membershipStamp } : {}),
      ...(data.membershipBootstrap ? { membershipBootstrap: data.membershipBootstrap } : {}),
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
          ? Temporal.Instant.fromEpochMilliseconds(data.resource.expiresAtMs)
          : null,
        maxViews: data.resource?.maxViews ?? null,
        occurredAt: Temporal.Instant.fromEpochMilliseconds(event.occurredAt),
      },
    };
  }

  mapAuthzGrantRoleChanged(event: GrantRoleChangedEvent): GrantProjectionWrite {
    return {
      kind: "grant.setRole",
      grantId: event.data.grantId,
      roleKey: event.data.to,
      occurredAt: Temporal.Instant.fromEpochMilliseconds(event.occurredAt),
    };
  }

  mapAuthzGrantRevoked(event: GrantRevokedEvent): GrantProjectionWrite {
    return {
      kind: "grant.revoke",
      grantId: event.data.grantId,
      reason: event.data.reason ?? null,
      occurredAt: Temporal.Instant.fromEpochMilliseconds(event.occurredAt),
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
        occurredAt: Temporal.Instant.fromEpochMilliseconds(event.occurredAt),
      },
    };
  }

  mapAuthzRolePermissionsChanged(event: RolePermissionsChangedEvent): GrantProjectionWrite {
    return {
      kind: "role.setPermissions",
      roleId: event.data.roleId,
      permissions: [...event.data.permissions],
      occurredAt: Temporal.Instant.fromEpochMilliseconds(event.occurredAt),
    };
  }

  mapAuthzRoleDeleted(event: RoleDeletedEvent): GrantProjectionWrite {
    return {
      kind: "role.delete",
      roleId: event.data.roleId,
      occurredAt: Temporal.Instant.fromEpochMilliseconds(event.occurredAt),
    };
  }
}
