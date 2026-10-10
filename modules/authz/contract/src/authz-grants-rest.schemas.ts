import { ledgerActorSchema } from "@langwatch/authorization";
import type { Named } from "@langwatch/module";
/**
 * The wire shapes of `/api/grants`, the successor to `/api/role-bindings`: a
 * grant names who (principal), what (role) and where (scope). Built-in roles
 * are the stable ids `admin`, `member` and `viewer`; a custom role is its id.
 */
import { z } from "zod";

import { authzPrincipalRefSchema } from "./authz.ts";

const MAX_ID_LENGTH = 128;
const idSchema = z.string().min(1).max(MAX_ID_LENGTH);

export const builtInRoleIdSchema = z.enum(["admin", "member", "viewer"]);
export type BuiltInRoleId = z.infer<typeof builtInRoleIdSchema>;

/** Every place a grant write names a role: a create, a role change, a member's new grants. */
const grantRolesSchema = z.object({
  roleId: z.string().optional(),
  grant: z.object({ roleId: z.string() }).optional(),
  bindingsToCreate: z.array(z.object({ customRoleId: z.string().nullish() })).optional(),
});

/** Whether a grant write assigns a role beyond the built-in three: an Enterprise question. */
export function assignsCustomGrantRole(input: unknown): boolean {
  const parsed = grantRolesSchema.safeParse(input);
  if (!parsed.success) return false;

  const { roleId, grant, bindingsToCreate = [] } = parsed.data;
  const named = [roleId, grant?.roleId].filter((id) => id !== undefined);

  return (
    named.some((id) => !builtInRoleIdSchema.validate(id)) ||
    bindingsToCreate.some((binding) => Boolean(binding.customRoleId))
  );
}

export const grantPrincipalTypeSchema = z.enum(["user", "group", "apiKey"]);
export type GrantPrincipalType = z.infer<typeof grantPrincipalTypeSchema>;

export const grantScopeTypeSchema = z.enum(["organization", "team", "project"]);
export type GrantScopeType = z.infer<typeof grantScopeTypeSchema>;

export const grantStatusSchema = z.enum(["active", "expired"]);
export type GrantStatus = z.infer<typeof grantStatusSchema>;

const grantSchemaDefinition = z.object({
  id: z.string(),
  principal: z.object({
    type: grantPrincipalTypeSchema,
    id: z.string(),
    name: z.string().nullable(),
  }),
  role: z.object({ id: z.string(), name: z.string().nullable(), builtIn: z.boolean() }),
  scope: z.object({ type: grantScopeTypeSchema, id: z.string(), name: z.string().nullable() }),
  /** Derived from expiresAt when read. */
  status: grantStatusSchema,
  /** When the grant stops granting, or null when it never does. */
  expiresAt: z.date().nullable(),
  createdAt: z.date(),
});
export interface GrantSchema extends Named<typeof grantSchemaDefinition> {}
export const grantSchema: GrantSchema = grantSchemaDefinition;
export type Grant = z.infer<typeof grantSchema>;

const grantCreateSchemaDefinition = z
  .object({
    principal: z.object({ type: grantPrincipalTypeSchema, id: idSchema }).strict(),
    roleId: idSchema,
    scope: z.object({ type: grantScopeTypeSchema, id: idSchema }).strict(),
    /** Optional ISO-8601 end date, strictly in the future (422 `grant_expiry_in_past`). */
    expiresAt: z.coerce.date().optional(),
  })
  .strict();
export interface GrantCreateSchema extends Named<typeof grantCreateSchemaDefinition> {}
export const grantCreateSchema: GrantCreateSchema = grantCreateSchemaDefinition;
export type GrantCreate = z.infer<typeof grantCreateSchema>;

/** Only the role changes: the principal and scope are the grant's identity. */
const grantUpdateSchemaDefinition = z.object({ roleId: idSchema }).strict();
export interface GrantUpdateSchema extends Named<typeof grantUpdateSchemaDefinition> {}
export const grantUpdateSchema: GrantUpdateSchema = grantUpdateSchemaDefinition;
export type GrantUpdate = z.infer<typeof grantUpdateSchema>;

/** `<createdAt ms>.<base64url id>`: opaque to callers, a position in the list to the service. */
export const GRANT_CURSOR_PATTERN = /^\d{1,16}\.[A-Za-z0-9_-]{1,256}$/;

export const grantListOrderSchema = z.enum(["newest", "oldest"]);
export type GrantListOrder = z.infer<typeof grantListOrderSchema>;

const grantListQuerySchemaDefinition = z.object({
  principalType: grantPrincipalTypeSchema.optional(),
  principalId: idSchema.optional(),
  roleId: idSchema.optional(),
  scopeType: grantScopeTypeSchema.optional(),
  scopeId: idSchema.optional(),
  /** Omitted lists both. */
  status: grantStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().regex(GRANT_CURSOR_PATTERN).optional(),
  /** By creation time; omitted is "oldest". A cursor continues the order that issued it. */
  order: grantListOrderSchema.optional(),
});
export interface GrantListQuerySchema extends Named<typeof grantListQuerySchemaDefinition> {}
export const grantListQuerySchema: GrantListQuerySchema = grantListQuerySchemaDefinition;
export type GrantListQuery = z.infer<typeof grantListQuerySchema>;

const grantPageSchemaDefinition = z.object({
  grants: z.array(grantSchema),
  /** Null when the list is finished. */
  nextCursor: z.string().nullable(),
});
export interface GrantPageSchema extends Named<typeof grantPageSchemaDefinition> {}
export const grantPageSchema: GrantPageSchema = grantPageSchemaDefinition;
export type GrantPage = z.infer<typeof grantPageSchema>;

const grantParamsSchemaDefinition = z.object({ grantId: idSchema });
export interface GrantParamsSchema extends Named<typeof grantParamsSchemaDefinition> {}
export const grantParamsSchema: GrantParamsSchema = grantParamsSchemaDefinition;
export type GrantParams = z.infer<typeof grantParamsSchema>;

const grantRevokedSchemaDefinition = z.object({ id: z.string(), revoked: z.literal(true) });
export interface GrantRevokedSchema extends Named<typeof grantRevokedSchemaDefinition> {}
export const grantRevokedSchema: GrantRevokedSchema = grantRevokedSchemaDefinition;
export type GrantRevoked = z.infer<typeof grantRevokedSchema>;

// ── the AuthzApi operations behind the family ─────────────────────────────────

const authzListGrantsInputSchemaDefinition = z
  .object({ organizationId: z.string().min(1), query: grantListQuerySchema })
  .strict();
export interface AuthzListGrantsInputSchema extends Named<
  typeof authzListGrantsInputSchemaDefinition
> {}
export const authzListGrantsInputSchema: AuthzListGrantsInputSchema =
  authzListGrantsInputSchemaDefinition;
export type AuthzListGrantsInput = z.infer<typeof authzListGrantsInputSchema>;

const authzGetGrantInputSchemaDefinition = z
  .object({ organizationId: z.string().min(1), grantId: z.string().min(1) })
  .strict();
export interface AuthzGetGrantInputSchema extends Named<
  typeof authzGetGrantInputSchemaDefinition
> {}
export const authzGetGrantInputSchema: AuthzGetGrantInputSchema =
  authzGetGrantInputSchemaDefinition;
export type AuthzGetGrantInput = z.infer<typeof authzGetGrantInputSchema>;

const authzCreateGrantInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    grant: grantCreateSchema,
    /** Whose permissions bound what may be granted: the key or the person asking. */
    caller: authzPrincipalRefSchema,
    actor: ledgerActorSchema,
  })
  .strict();
export interface AuthzCreateGrantInputSchema extends Named<
  typeof authzCreateGrantInputSchemaDefinition
> {}
export const authzCreateGrantInputSchema: AuthzCreateGrantInputSchema =
  authzCreateGrantInputSchemaDefinition;
export type AuthzCreateGrantInput = z.infer<typeof authzCreateGrantInputSchema>;

const authzChangeGrantRoleInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    grantId: z.string().min(1),
    roleId: z.string().min(1),
    caller: authzPrincipalRefSchema,
    actor: ledgerActorSchema,
  })
  .strict();
export interface AuthzChangeGrantRoleInputSchema extends Named<
  typeof authzChangeGrantRoleInputSchemaDefinition
> {}
export const authzChangeGrantRoleInputSchema: AuthzChangeGrantRoleInputSchema =
  authzChangeGrantRoleInputSchemaDefinition;
export type AuthzChangeGrantRoleInput = z.infer<typeof authzChangeGrantRoleInputSchema>;

const authzRevokeGrantByIdInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    grantId: z.string().min(1),
    caller: authzPrincipalRefSchema,
    actor: ledgerActorSchema,
  })
  .strict();
export interface AuthzRevokeGrantByIdInputSchema extends Named<
  typeof authzRevokeGrantByIdInputSchemaDefinition
> {}
export const authzRevokeGrantByIdInputSchema: AuthzRevokeGrantByIdInputSchema =
  authzRevokeGrantByIdInputSchemaDefinition;
export type AuthzRevokeGrantByIdInput = z.infer<typeof authzRevokeGrantByIdInputSchema>;

const authzFindPermissionsBeyondCallerInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    caller: authzPrincipalRefSchema,
    scope: z.object({ type: grantScopeTypeSchema, id: z.string().min(1) }).strict(),
    permissions: z.array(z.string()),
  })
  .strict();
export interface AuthzFindPermissionsBeyondCallerInputSchema extends Named<
  typeof authzFindPermissionsBeyondCallerInputSchemaDefinition
> {}
export const authzFindPermissionsBeyondCallerInputSchema: AuthzFindPermissionsBeyondCallerInputSchema =
  authzFindPermissionsBeyondCallerInputSchemaDefinition;
export type AuthzFindPermissionsBeyondCallerInput = z.infer<
  typeof authzFindPermissionsBeyondCallerInputSchema
>;
