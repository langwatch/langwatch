import { grantConditionSchema, ledgerActorSchema } from "@langwatch/authorization";
import type { Named } from "@langwatch/module";
import { z } from "zod";

import { PROJECT_READER_ROLE_KEY } from "./roles.ts";

export const AUTHZ_ENGINE_MIGRATION_NAME = "authz-engine" as const;

export const GRANT_ATTACHED_EVENT_TYPE = "lw.authz.grant.attached" as const;
export const GRANT_ROLE_CHANGED_EVENT_TYPE = "lw.authz.grant.role_changed" as const;
export const GRANT_REVOKED_EVENT_TYPE = "lw.authz.grant.revoked" as const;
export const ROLE_DEFINED_EVENT_TYPE = "lw.authz.role.defined" as const;
export const ROLE_PERMISSIONS_CHANGED_EVENT_TYPE = "lw.authz.role.permissions_changed" as const;
export const ROLE_DELETED_EVENT_TYPE = "lw.authz.role.deleted" as const;

export const AUTHZ_GRANT_EVENT_TYPES = [
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
] as const;
export const AUTHZ_ROLE_EVENT_TYPES = [
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
] as const;
export const AUTHZ_GRANTS_EVENT_TYPES = [
  ...AUTHZ_GRANT_EVENT_TYPES,
  ...AUTHZ_ROLE_EVENT_TYPES,
] as const;
export const AUTHZ_GRANTS_EVENT_VERSION_LATEST = "2026-08-20" as const;

const ledgerPrincipalSchemaDefinition = z
  .object({
    type: z.enum(["user", "apiKey", "group", "team", "organization", "project", "anyone"]),
    id: z.string().nullable(),
  })
  .strict()
  .refine((principal) => (principal.type === "anyone") === (principal.id === null), {
    message: "principal id is null for `anyone` and required for every other principal type",
    path: ["id"],
  });
export interface LedgerPrincipalSchema extends Named<typeof ledgerPrincipalSchemaDefinition> {}
export const ledgerPrincipalSchema: LedgerPrincipalSchema = ledgerPrincipalSchemaDefinition;
export type LedgerPrincipal = z.infer<typeof ledgerPrincipalSchema>;
export type LedgerPrincipalType = LedgerPrincipal["type"];

export const legacyBindingRoleSchema = z.enum(["ADMIN", "MEMBER", "VIEWER", "CUSTOM"]);
export type LegacyBindingRole = z.infer<typeof legacyBindingRoleSchema>;

const ledgerScopeSchemaDefinition = z
  .object({
    type: z.enum(["ORGANIZATION", "TEAM", "PROJECT", "RESOURCE", "PLATFORM"]),
    id: z.string(),
  })
  .strict();
export interface LedgerScopeSchema extends Named<typeof ledgerScopeSchemaDefinition> {}
export const ledgerScopeSchema: LedgerScopeSchema = ledgerScopeSchemaDefinition;
export type LedgerScope = z.infer<typeof ledgerScopeSchema>;
export type LedgerScopeType = LedgerScope["type"];

export const GRANT_EVENT_SOURCES = [
  "grants-service",
  "scim",
  "invite",
  "join-request",
  "read-through-mint",
  "migration",
  "aggregate-reconciler",
] as const;
export const grantEventSourceSchema = z.enum(GRANT_EVENT_SOURCES);
export type GrantEventSource = z.infer<typeof grantEventSourceSchema>;

const resourceGrantTermsSchemaDefinition = z
  .object({
    kind: z.enum(["trace", "thread"]),
    projectId: z.string().min(1),
    token: z.string().min(1),
    permission: z.string().min(1),
    createdByUserId: z.string().min(1).optional(),
    expiresAtMs: z.number().int().nonnegative().optional(),
    maxViews: z.number().int().nonnegative().optional(),
  })
  .strict();
export interface ResourceGrantTermsSchema extends Named<
  typeof resourceGrantTermsSchemaDefinition
> {}
export const resourceGrantTermsSchema: ResourceGrantTermsSchema =
  resourceGrantTermsSchemaDefinition;
export type ResourceGrantTerms = z.infer<typeof resourceGrantTermsSchema>;

/**
 * A `project` principal sits at RESOURCE scope, as its own project's credential,
 * or as the ADR-177 shared read: `project-reader` on another project's PROJECT
 * scope carrying a condition whose `where` is empty (nothing compiles OTTL yet).
 */
export const grantShapeRefinement = {
  check: (grant: {
    principal: { type: string; id: string | null };
    roleKey: string | null;
    scope: { type: string; id: string };
    resource?: unknown;
    expiresAtMs?: number;
    condition?: { where?: string };
  }): boolean => {
    const isResourceScope = grant.scope.type === "RESOURCE";
    if (grant.principal.type === "anyone" && !isResourceScope) return false;
    if (isResourceScope && grant.expiresAtMs !== undefined) return false;
    const isOwnProjectCredential =
      grant.scope.type === "PROJECT" && grant.principal.id === grant.scope.id;
    const isSharedProjectRead =
      grant.principal.type === "project" &&
      grant.scope.type === "PROJECT" &&
      grant.principal.id !== grant.scope.id &&
      grant.roleKey === PROJECT_READER_ROLE_KEY &&
      grant.condition !== undefined &&
      (grant.condition.where === undefined || grant.condition.where === "");
    if (
      grant.principal.type === "project" &&
      !isResourceScope &&
      !isOwnProjectCredential &&
      !isSharedProjectRead
    ) {
      return false;
    }
    if ((grant.condition !== undefined) !== isSharedProjectRead) return false;
    if ((grant.roleKey === PROJECT_READER_ROLE_KEY) !== isSharedProjectRead) return false;
    return (
      isResourceScope === (grant.resource !== undefined) &&
      isResourceScope === (grant.roleKey === null)
    );
  },
  message:
    "a RESOURCE grant carries resource terms and a null roleKey, every other scope carries a roleKey and no resource terms; a RESOURCE grant states its expiry inside those terms and never as the grant's own `expiresAtMs`; `anyone` principals exist only at RESOURCE scope, a `project` principal exists at RESOURCE scope, as its own project's credential (a PROJECT scope whose id is the principal's), or as a `project-reader` on another project's PROJECT scope carrying a condition with an empty where; only that shared read carries a condition or the `project-reader` role",
  path: ["resource"] as const,
};

const grantAttachedPayloadSchemaDefinition = z
  .object({
    grantId: z.string().min(1),
    principal: ledgerPrincipalSchema,
    roleKey: z.string().min(1).nullable(),
    scope: ledgerScopeSchema,
    resource: resourceGrantTermsSchema.optional(),
    /** Present only on a shared project-reader grant (ADR-177). */
    condition: grantConditionSchema.optional(),
    legacyRole: legacyBindingRoleSchema.optional(),
    /** When a binding stops granting; absent on every grant that never ends. */
    expiresAtMs: z.number().int().positive().optional(),
    source: grantEventSourceSchema,
    actor: ledgerActorSchema,
    /** Present on live USER grants; absent on imported history. */
    membershipStamp: z.string().min(1).optional(),
    /** Founder-only marker for a membership created in the same transaction. */
    membershipBootstrap: z.boolean().optional(),
    /** Present when the writer asked to skip an identical live grant: the fold
     *  drops this fact when one already landed, so a write inside the lag adds no row. */
    onDuplicate: z.literal("skip").optional(),
  })
  .strict()
  .refine(grantShapeRefinement.check, {
    message: grantShapeRefinement.message,
    path: [...grantShapeRefinement.path],
  })
  .refine((grant) => !grant.membershipBootstrap || grant.membershipStamp, {
    message: "membershipBootstrap requires membershipStamp",
    path: ["membershipStamp"],
  });
export interface GrantAttachedPayloadSchema extends Named<
  typeof grantAttachedPayloadSchemaDefinition
> {}
export const grantAttachedPayloadSchema: GrantAttachedPayloadSchema =
  grantAttachedPayloadSchemaDefinition;
export type GrantAttachedPayload = z.infer<typeof grantAttachedPayloadSchema>;

const grantRoleChangedPayloadSchemaDefinition = z
  .object({
    grantId: z.string().min(1),
    from: z.string().min(1).nullable(),
    to: z.string().min(1),
    actor: ledgerActorSchema,
  })
  .strict();
export interface GrantRoleChangedPayloadSchema extends Named<
  typeof grantRoleChangedPayloadSchemaDefinition
> {}
export const grantRoleChangedPayloadSchema: GrantRoleChangedPayloadSchema =
  grantRoleChangedPayloadSchemaDefinition;
export type GrantRoleChangedPayload = z.infer<typeof grantRoleChangedPayloadSchema>;

const grantRevokedPayloadSchemaDefinition = z
  .object({
    grantId: z.string().min(1),
    reason: z.string().min(1).optional(),
    actor: ledgerActorSchema,
  })
  .strict();
export interface GrantRevokedPayloadSchema extends Named<
  typeof grantRevokedPayloadSchemaDefinition
> {}
export const grantRevokedPayloadSchema: GrantRevokedPayloadSchema =
  grantRevokedPayloadSchemaDefinition;
export type GrantRevokedPayload = z.infer<typeof grantRevokedPayloadSchema>;

const roleDefinedPayloadSchemaDefinition = z
  .object({
    roleId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    permissions: z.array(z.string().min(1)),
    kind: z.enum(["custom", "system_api_key"]),
    actor: ledgerActorSchema,
  })
  .strict();
export interface RoleDefinedPayloadSchema extends Named<
  typeof roleDefinedPayloadSchemaDefinition
> {}
export const roleDefinedPayloadSchema: RoleDefinedPayloadSchema =
  roleDefinedPayloadSchemaDefinition;
export type RoleDefinedPayload = z.infer<typeof roleDefinedPayloadSchema>;

const rolePermissionsChangedPayloadSchemaDefinition = z
  .object({
    roleId: z.string().min(1),
    permissions: z.array(z.string().min(1)),
    actor: ledgerActorSchema,
  })
  .strict();
export interface RolePermissionsChangedPayloadSchema extends Named<
  typeof rolePermissionsChangedPayloadSchemaDefinition
> {}
export const rolePermissionsChangedPayloadSchema: RolePermissionsChangedPayloadSchema =
  rolePermissionsChangedPayloadSchemaDefinition;
export type RolePermissionsChangedPayload = z.infer<typeof rolePermissionsChangedPayloadSchema>;

const roleDeletedPayloadSchemaDefinition = z
  .object({
    roleId: z.string().min(1),
    actor: ledgerActorSchema,
  })
  .strict();
export interface RoleDeletedPayloadSchema extends Named<
  typeof roleDeletedPayloadSchemaDefinition
> {}
export const roleDeletedPayloadSchema: RoleDeletedPayloadSchema =
  roleDeletedPayloadSchemaDefinition;
export type RoleDeletedPayload = z.infer<typeof roleDeletedPayloadSchema>;

/** Portable event type plus data only; Eventing owns the outer envelope. */
const authzGrantEventPayloadSchemaDefinition = z.discriminatedUnion("type", [
  z.object({
    type: z.literal(GRANT_ATTACHED_EVENT_TYPE),
    data: grantAttachedPayloadSchema,
  }),
  z.object({
    type: z.literal(GRANT_ROLE_CHANGED_EVENT_TYPE),
    data: grantRoleChangedPayloadSchema,
  }),
  z.object({
    type: z.literal(GRANT_REVOKED_EVENT_TYPE),
    data: grantRevokedPayloadSchema,
  }),
  z.object({
    type: z.literal(ROLE_DEFINED_EVENT_TYPE),
    data: roleDefinedPayloadSchema,
  }),
  z.object({
    type: z.literal(ROLE_PERMISSIONS_CHANGED_EVENT_TYPE),
    data: rolePermissionsChangedPayloadSchema,
  }),
  z.object({
    type: z.literal(ROLE_DELETED_EVENT_TYPE),
    data: roleDeletedPayloadSchema,
  }),
]);
export interface AuthzGrantEventPayloadSchema extends Named<
  typeof authzGrantEventPayloadSchemaDefinition
> {}
export const authzGrantEventPayloadSchema: AuthzGrantEventPayloadSchema =
  authzGrantEventPayloadSchemaDefinition;
export type AuthzGrantEventPayload = z.infer<typeof authzGrantEventPayloadSchema>;

const grantFactSchemaDefinition = z
  .object({
    grantId: z.string().min(1),
    principal: ledgerPrincipalSchema,
    roleKey: z.string().min(1).nullable(),
    scope: ledgerScopeSchema,
    resource: resourceGrantTermsSchema.optional(),
    legacyRole: legacyBindingRoleSchema.optional(),
    expiresAtMs: z.number().int().positive().optional(),
    source: grantEventSourceSchema,
    /** Current USER membership lifetime; absent for non-user/resource facts. */
    membershipStamp: z.string().min(1).optional(),
    /** The shared grant's window (ADR-177); absent on own grants. */
    condition: grantConditionSchema.optional(),
    occurredAtMs: z.number().int().nonnegative(),
  })
  .strict()
  .refine(grantShapeRefinement.check, {
    message: grantShapeRefinement.message,
    path: [...grantShapeRefinement.path],
  });
export interface GrantFactSchema extends Named<typeof grantFactSchemaDefinition> {}
export const grantFactSchema: GrantFactSchema = grantFactSchemaDefinition;
export type GrantFact = z.infer<typeof grantFactSchema>;

const roleFactSchemaDefinition = z
  .object({
    roleId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    permissions: z.array(z.string()),
    kind: z.enum(["custom", "system_api_key"]),
    occurredAtMs: z.number().int().nonnegative(),
  })
  .strict();
export interface RoleFactSchema extends Named<typeof roleFactSchemaDefinition> {}
export const roleFactSchema: RoleFactSchema = roleFactSchemaDefinition;
export type RoleFact = z.infer<typeof roleFactSchema>;

export const migrationTenantStatusSchema = z.enum([
  "migrated",
  "finalized",
  "parked",
  "rolled_back",
]);
export type MigrationTenantStatus = z.infer<typeof migrationTenantStatusSchema>;
