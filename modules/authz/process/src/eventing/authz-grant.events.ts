import {
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  grantAttachedPayloadSchema,
  grantRevokedPayloadSchema,
  grantRoleChangedPayloadSchema,
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
  roleDefinedPayloadSchema,
  roleDeletedPayloadSchema,
  rolePermissionsChangedPayloadSchema,
  type GrantAttachedPayload,
  type GrantRevokedPayload,
  type GrantRoleChangedPayload,
  type RoleDefinedPayload,
  type RoleDeletedPayload,
  type RolePermissionsChangedPayload,
} from "@langwatch/authz-contract";
import { type Event, EventSchema } from "@langwatch/eventing";
import { z } from "zod";

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

export const authzGrantEventSchemas = [
  z.object({
    ...EventSchema.shape,
    type: z.literal(GRANT_ATTACHED_EVENT_TYPE),
    data: grantAttachedPayloadSchema,
  }),
  z.object({
    ...EventSchema.shape,
    type: z.literal(GRANT_ROLE_CHANGED_EVENT_TYPE),
    data: grantRoleChangedPayloadSchema,
  }),
  z.object({
    ...EventSchema.shape,
    type: z.literal(GRANT_REVOKED_EVENT_TYPE),
    data: grantRevokedPayloadSchema,
  }),
  z.object({
    ...EventSchema.shape,
    type: z.literal(ROLE_DEFINED_EVENT_TYPE),
    data: roleDefinedPayloadSchema,
  }),
  z.object({
    ...EventSchema.shape,
    type: z.literal(ROLE_PERMISSIONS_CHANGED_EVENT_TYPE),
    data: rolePermissionsChangedPayloadSchema,
  }),
  z.object({
    ...EventSchema.shape,
    type: z.literal(ROLE_DELETED_EVENT_TYPE),
    data: roleDeletedPayloadSchema,
  }),
] as const;
