import {
  type GrantAttachedPayload,
  GRANT_ATTACHED_EVENT_TYPE,
  type GrantRevokedPayload,
  GRANT_REVOKED_EVENT_TYPE,
  type GrantRoleChangedPayload,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  type RoleDefinedPayload,
  ROLE_DEFINED_EVENT_TYPE,
  type RoleDeletedPayload,
  ROLE_DELETED_EVENT_TYPE,
  type RolePermissionsChangedPayload,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
} from "@langwatch/authz-contract";
import type { Event } from "@langwatch/eventing";

/**
 * Both grants and roles use this one Eventing partition. Their aggregate IDs
 * remain the individual grant or role IDs; the organization is their tenant.
 */
export const AUTHZ_GRANT_AGGREGATE_TYPE = "authz_grant" as const;

type AuthzEvent<Type extends string, Payload> = Event<Payload> & {
  type: Type;
};

export type GrantAttachedEvent = AuthzEvent<typeof GRANT_ATTACHED_EVENT_TYPE, GrantAttachedPayload>;
export type GrantRoleChangedEvent = AuthzEvent<
  typeof GRANT_ROLE_CHANGED_EVENT_TYPE,
  GrantRoleChangedPayload
>;
export type GrantRevokedEvent = AuthzEvent<typeof GRANT_REVOKED_EVENT_TYPE, GrantRevokedPayload>;
export type RoleDefinedEvent = AuthzEvent<typeof ROLE_DEFINED_EVENT_TYPE, RoleDefinedPayload>;
export type RolePermissionsChangedEvent = AuthzEvent<
  typeof ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
  RolePermissionsChangedPayload
>;
export type RoleDeletedEvent = AuthzEvent<typeof ROLE_DELETED_EVENT_TYPE, RoleDeletedPayload>;

export type AuthzGrantsEvent =
  | GrantAttachedEvent
  | GrantRoleChangedEvent
  | GrantRevokedEvent
  | RoleDefinedEvent
  | RolePermissionsChangedEvent
  | RoleDeletedEvent;
