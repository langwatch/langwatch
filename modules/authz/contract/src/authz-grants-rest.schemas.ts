/**
 * The wire shapes of `/api/grants`, the successor to `/api/role-bindings`: a
 * grant names who (principal), what (role) and where (scope). Built-in roles
 * are the stable ids `admin`, `member` and `viewer`; a custom role is its id.
 */
import { z } from "zod";

import { grantsLedgerActorSchema } from "./authz-grant.events.ts";
import { authzPrincipalRefSchema } from "./authz.ts";

const MAX_ID_LENGTH = 128;
const idSchema = z.string().min(1).max(MAX_ID_LENGTH);

export const builtInRoleIdSchema = z.enum(["admin", "member", "viewer"]);
export type BuiltInRoleId = z.infer<typeof builtInRoleIdSchema>;

export const grantPrincipalTypeSchema = z.enum(["user", "group", "apiKey"]);
export type GrantPrincipalType = z.infer<typeof grantPrincipalTypeSchema>;

export const grantScopeTypeSchema = z.enum(["organization", "team", "project"]);
export type GrantScopeType = z.infer<typeof grantScopeTypeSchema>;

export const grantStatusSchema = z.enum(["active", "expired"]);
export type GrantStatus = z.infer<typeof grantStatusSchema>;

export const grantSchema = z.object({
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
export type Grant = z.infer<typeof grantSchema>;

export const grantCreateSchema = z
  .object({
    principal: z.object({ type: grantPrincipalTypeSchema, id: idSchema }).strict(),
    roleId: idSchema,
    scope: z.object({ type: grantScopeTypeSchema, id: idSchema }).strict(),
    /** Optional ISO-8601 end date, strictly in the future (422 `grant_expiry_in_past`). */
    expiresAt: z.coerce.date().optional(),
  })
  .strict();
export type GrantCreate = z.infer<typeof grantCreateSchema>;

/** Only the role changes: the principal and scope are the grant's identity. */
export const grantUpdateSchema = z.object({ roleId: idSchema }).strict();
export type GrantUpdate = z.infer<typeof grantUpdateSchema>;

/** `<createdAt ms>.<base64url id>`: opaque to callers, a position in the list to the service. */
export const GRANT_CURSOR_PATTERN = /^\d{1,16}\.[A-Za-z0-9_-]{1,256}$/;

export const grantListQuerySchema = z.object({
  principalType: grantPrincipalTypeSchema.optional(),
  principalId: idSchema.optional(),
  roleId: idSchema.optional(),
  scopeType: grantScopeTypeSchema.optional(),
  scopeId: idSchema.optional(),
  /** Omitted lists both. */
  status: grantStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().regex(GRANT_CURSOR_PATTERN).optional(),
});
export type GrantListQuery = z.infer<typeof grantListQuerySchema>;

export const grantPageSchema = z.object({
  grants: z.array(grantSchema),
  /** Null when the list is finished. */
  nextCursor: z.string().nullable(),
});
export type GrantPage = z.infer<typeof grantPageSchema>;

export const grantParamsSchema = z.object({ grantId: idSchema });
export type GrantParams = z.infer<typeof grantParamsSchema>;

export const grantRevokedSchema = z.object({ id: z.string(), revoked: z.literal(true) });
export type GrantRevoked = z.infer<typeof grantRevokedSchema>;

// ── the AuthzApi operations behind the family ─────────────────────────────────

export const authzListGrantsInputSchema = z
  .object({ organizationId: z.string().min(1), query: grantListQuerySchema })
  .strict();
export type AuthzListGrantsInput = z.infer<typeof authzListGrantsInputSchema>;

export const authzGetGrantInputSchema = z
  .object({ organizationId: z.string().min(1), grantId: z.string().min(1) })
  .strict();
export type AuthzGetGrantInput = z.infer<typeof authzGetGrantInputSchema>;

export const authzCreateGrantInputSchema = z
  .object({
    organizationId: z.string().min(1),
    grant: grantCreateSchema,
    /** Whose permissions bound what may be granted: the key or the person asking. */
    caller: authzPrincipalRefSchema,
    actor: grantsLedgerActorSchema,
  })
  .strict();
export type AuthzCreateGrantInput = z.infer<typeof authzCreateGrantInputSchema>;

export const authzChangeGrantRoleInputSchema = z
  .object({
    organizationId: z.string().min(1),
    grantId: z.string().min(1),
    roleId: z.string().min(1),
    caller: authzPrincipalRefSchema,
    actor: grantsLedgerActorSchema,
  })
  .strict();
export type AuthzChangeGrantRoleInput = z.infer<typeof authzChangeGrantRoleInputSchema>;

export const authzRevokeGrantByIdInputSchema = z
  .object({
    organizationId: z.string().min(1),
    grantId: z.string().min(1),
    actor: grantsLedgerActorSchema,
  })
  .strict();
export type AuthzRevokeGrantByIdInput = z.infer<typeof authzRevokeGrantByIdInputSchema>;

export const authzFindPermissionsBeyondCallerInputSchema = z
  .object({
    organizationId: z.string().min(1),
    caller: authzPrincipalRefSchema,
    scope: z.object({ type: grantScopeTypeSchema, id: z.string().min(1) }).strict(),
    permissions: z.array(z.string()),
  })
  .strict();
export type AuthzFindPermissionsBeyondCallerInput = z.infer<
  typeof authzFindPermissionsBeyondCallerInputSchema
>;
