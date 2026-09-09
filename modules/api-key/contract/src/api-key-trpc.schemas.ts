/**
 * The input parsers of the `apiKey.*` tRPC namespace, living in the contract
 * because the browser reads the same declaration the server binds.
 */
import { z } from "zod";

import { apiKeyPermissionSchema, apiKeyRoleSchema, apiKeyScopeTypeSchema } from "./api-key.ts";
import { API_KEY_PERMISSION_MODES, refineRestrictedPermissions } from "./api-key.permissions.ts";

/**
 * The binding shape the drawers post. Deliberately narrower than the
 * contract's `apiKeyScopeSchema`: it is not `.strict()`, so a stray field is
 * stripped rather than refused, and it carries no `customRoleId` — a
 * restricted key's custom role is minted by the service, never named by the
 * client.
 */
const roleBindingSchema = z.object({
  role: apiKeyRoleSchema,
  scopeType: apiKeyScopeTypeSchema,
  scopeId: z.string(),
});
/** One binding as the drawers write it. */
export type ApiKeyTrpcRoleBinding = z.infer<typeof roleBindingSchema>;

/** Every read and write on the namespace is narrowed to one organization. */
export const apiKeyTrpcOrganizationScopeSchema = z.object({ organizationId: z.string() });

export const apiKeyTrpcNameByIdInputSchema = z.object({
  organizationId: z.string(),
  apiKeyId: z.string(),
});

export const apiKeyTrpcCreateInputSchema = z
  .object({
    organizationId: z.string(),
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    expiresAt: z.coerce.date().optional(),
    permissionMode: z.enum(API_KEY_PERMISSION_MODES).default("all"),
    keyType: z.enum(["personal", "service"]).default("personal"),
    assignedToUserId: z.string().optional(),
    permissions: z.array(apiKeyPermissionSchema).optional(),
    bindings: z.array(roleBindingSchema).max(20),
  })
  .superRefine(refineRestrictedPermissions);
export type ApiKeyTrpcCreateInput = z.infer<typeof apiKeyTrpcCreateInputSchema>;

export const apiKeyTrpcUpdateInputSchema = z
  .object({
    organizationId: z.string(),
    apiKeyId: z.string(),
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullish(),
    permissionMode: z.enum(API_KEY_PERMISSION_MODES).optional(),
    permissions: z.array(apiKeyPermissionSchema).optional(),
    bindings: z.array(roleBindingSchema).min(1).max(20).optional(),
  })
  .superRefine(refineRestrictedPermissions);
export type ApiKeyTrpcUpdateInput = z.infer<typeof apiKeyTrpcUpdateInputSchema>;

export const apiKeyTrpcRevokeInputSchema = z.object({
  organizationId: z.string(),
  apiKeyId: z.string(),
});
