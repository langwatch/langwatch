import { z } from "zod";

export const AUTHZ_ENGINE_MIGRATION_NAME = "authz-engine" as const;

export const GRANT_ATTACHED_EVENT_TYPE = "lw.authz.grant.attached" as const;
export const GRANT_ROLE_CHANGED_EVENT_TYPE =
  "lw.authz.grant.role_changed" as const;
export const GRANT_REVOKED_EVENT_TYPE = "lw.authz.grant.revoked" as const;
export const ROLE_DEFINED_EVENT_TYPE = "lw.authz.role.defined" as const;
export const ROLE_PERMISSIONS_CHANGED_EVENT_TYPE =
  "lw.authz.role.permissions_changed" as const;
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

export const ledgerPrincipalSchema = z
  .object({
    type: z.enum([
      "user",
      "apiKey",
      "group",
      "team",
      "organization",
      "project",
      "anyone",
    ]),
    id: z.string().nullable(),
  })
  .strict()
  .refine(
    (principal) => (principal.type === "anyone") === (principal.id === null),
    {
      message:
        "principal id is null for `anyone` and required for every other principal type",
      path: ["id"],
    },
  );
export type LedgerPrincipal = z.infer<typeof ledgerPrincipalSchema>;
export type LedgerPrincipalType = LedgerPrincipal["type"];

export const legacyBindingRoleSchema = z.enum([
  "ADMIN",
  "MEMBER",
  "VIEWER",
  "CUSTOM",
]);
export type LegacyBindingRole = z.infer<typeof legacyBindingRoleSchema>;

export const ledgerScopeSchema = z
  .object({
    type: z.enum(["ORGANIZATION", "TEAM", "PROJECT", "RESOURCE", "PLATFORM"]),
    id: z.string(),
  })
  .strict();
export type LedgerScope = z.infer<typeof ledgerScopeSchema>;
export type LedgerScopeType = LedgerScope["type"];

export const GRANT_EVENT_SOURCES = [
  "grants-service",
  "scim",
  "invite",
  "read-through-mint",
  "migration",
] as const;
export const grantEventSourceSchema = z.enum(GRANT_EVENT_SOURCES);
export type GrantEventSource = z.infer<typeof grantEventSourceSchema>;

export const grantsLedgerActorSchema = z
  .object({ type: z.enum(["user", "system"]), id: z.string().nullable() })
  .strict();
export type GrantsLedgerActor = z.infer<typeof grantsLedgerActorSchema>;

export const resourceGrantTermsSchema = z
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
export type ResourceGrantTerms = z.infer<typeof resourceGrantTermsSchema>;

export const grantShapeRefinement = {
  check: (grant: {
    principal: { type: string; id: string | null };
    roleKey: string | null;
    scope: { type: string; id: string };
    resource?: unknown;
  }): boolean => {
    const isResourceScope = grant.scope.type === "RESOURCE";
    if (grant.principal.type === "anyone" && !isResourceScope) return false;
    const isOwnProjectCredential =
      grant.scope.type === "PROJECT" && grant.principal.id === grant.scope.id;
    if (
      grant.principal.type === "project" &&
      !isResourceScope &&
      !isOwnProjectCredential
    ) {
      return false;
    }
    return (
      isResourceScope === (grant.resource !== undefined) &&
      isResourceScope === (grant.roleKey === null)
    );
  },
  message:
    "a RESOURCE grant carries resource terms and a null roleKey, every other scope carries a roleKey and no resource terms; `anyone` principals exist only at RESOURCE scope, and a `project` principal exists at RESOURCE scope or as its own project's credential (a PROJECT scope whose id is the principal's)",
  path: ["resource"] as const,
};

export const grantAttachedPayloadSchema = z
  .object({
    grantId: z.string().min(1),
    principal: ledgerPrincipalSchema,
    roleKey: z.string().min(1).nullable(),
    scope: ledgerScopeSchema,
    resource: resourceGrantTermsSchema.optional(),
    legacyRole: legacyBindingRoleSchema.optional(),
    source: grantEventSourceSchema,
    actor: grantsLedgerActorSchema,
  })
  .strict()
  .refine(grantShapeRefinement.check, {
    message: grantShapeRefinement.message,
    path: [...grantShapeRefinement.path],
  });
export type GrantAttachedPayload = z.infer<typeof grantAttachedPayloadSchema>;

export const grantRoleChangedPayloadSchema = z
  .object({
    grantId: z.string().min(1),
    from: z.string().min(1).nullable(),
    to: z.string().min(1),
    actor: grantsLedgerActorSchema,
  })
  .strict();
export type GrantRoleChangedPayload = z.infer<
  typeof grantRoleChangedPayloadSchema
>;

export const grantRevokedPayloadSchema = z
  .object({
    grantId: z.string().min(1),
    reason: z.string().min(1).optional(),
    actor: grantsLedgerActorSchema,
  })
  .strict();
export type GrantRevokedPayload = z.infer<typeof grantRevokedPayloadSchema>;

export const roleDefinedPayloadSchema = z
  .object({
    roleId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    permissions: z.array(z.string().min(1)),
    kind: z.enum(["custom", "system_api_key"]),
    actor: grantsLedgerActorSchema,
  })
  .strict();
export type RoleDefinedPayload = z.infer<typeof roleDefinedPayloadSchema>;

export const rolePermissionsChangedPayloadSchema = z
  .object({
    roleId: z.string().min(1),
    permissions: z.array(z.string().min(1)),
    actor: grantsLedgerActorSchema,
  })
  .strict();
export type RolePermissionsChangedPayload = z.infer<
  typeof rolePermissionsChangedPayloadSchema
>;

export const roleDeletedPayloadSchema = z
  .object({
    roleId: z.string().min(1),
    actor: grantsLedgerActorSchema,
  })
  .strict();
export type RoleDeletedPayload = z.infer<typeof roleDeletedPayloadSchema>;

/** Portable event type plus data only; Eventing owns the outer envelope. */
export const authzGrantEventPayloadSchema = z.discriminatedUnion("type", [
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
export type AuthzGrantEventPayload = z.infer<
  typeof authzGrantEventPayloadSchema
>;

export const grantFactSchema = attachGrantEntryFactSchema();
export type GrantFact = z.infer<typeof grantFactSchema>;

function attachGrantEntryFactSchema() {
  return z
    .object({
      grantId: z.string().min(1),
      principal: ledgerPrincipalSchema,
      roleKey: z.string().min(1).nullable(),
      scope: ledgerScopeSchema,
      resource: resourceGrantTermsSchema.optional(),
      legacyRole: legacyBindingRoleSchema.optional(),
      source: grantEventSourceSchema,
      occurredAtMs: z.number().int().nonnegative(),
    })
    .strict()
    .refine(grantShapeRefinement.check, {
      message: grantShapeRefinement.message,
      path: [...grantShapeRefinement.path],
    });
}

export const roleFactSchema = z
  .object({
    roleId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    permissions: z.array(z.string()),
    kind: z.enum(["custom", "system_api_key"]),
    occurredAtMs: z.number().int().nonnegative(),
  })
  .strict();
export type RoleFact = z.infer<typeof roleFactSchema>;

export const migrationTenantStatusSchema = z.enum([
  "migrated",
  "finalized",
  "parked",
  "rolled_back",
]);
export type MigrationTenantStatus = z.infer<typeof migrationTenantStatusSchema>;
