import type { Named } from "@langwatch/module";
/**
 * The input parsers of the `apiKey.*` tRPC namespace, living in the contract
 * because the browser reads the same declaration the server binds.
 */
import { z } from "zod";

import { API_KEY_PERMISSION_MODES, refineRestrictedPermissions } from "./api-key.permissions.ts";
import {
  apiKeyPermissionFormatSchema,
  apiKeyRoleSchema,
  apiKeyScopeTypeSchema,
} from "./api-key.ts";

/**
 * The binding shape the drawers post — narrower than the contract's
 * `apiKeyScopeSchema`: not `.strict()`, so a stray field is stripped, and
 * no `customRoleId` — a restricted key's role is minted by the service.
 */
const grantWriteSchema = z.object({
  role: apiKeyRoleSchema,
  scopeType: apiKeyScopeTypeSchema,
  scopeId: z.string(),
});
/** One binding as the drawers write it. */
export type ApiKeyTrpcGrant = z.infer<typeof grantWriteSchema>;

/** Every read and write on the namespace is narrowed to one organization. */
const apiKeyTrpcOrganizationScopeSchemaDefinition = z.object({ organizationId: z.string() });
export interface ApiKeyTrpcOrganizationScopeSchema extends Named<
  typeof apiKeyTrpcOrganizationScopeSchemaDefinition
> {}
export const apiKeyTrpcOrganizationScopeSchema: ApiKeyTrpcOrganizationScopeSchema =
  apiKeyTrpcOrganizationScopeSchemaDefinition;

const apiKeyTrpcNameByIdInputSchemaDefinition = z.object({
  organizationId: z.string(),
  apiKeyId: z.string(),
});
export interface ApiKeyTrpcNameByIdInputSchema extends Named<
  typeof apiKeyTrpcNameByIdInputSchemaDefinition
> {}
export const apiKeyTrpcNameByIdInputSchema: ApiKeyTrpcNameByIdInputSchema =
  apiKeyTrpcNameByIdInputSchemaDefinition;

const apiKeyTrpcCreateInputSchemaDefinition = z
  .object({
    organizationId: z.string(),
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    expiresAt: z.coerce.date().optional(),
    permissionMode: z.enum(API_KEY_PERMISSION_MODES).default("all"),
    keyType: z.enum(["personal", "service"]).default("personal"),
    assignedToUserId: z.string().optional(),
    permissions: z.array(apiKeyPermissionFormatSchema).optional(),
    bindings: z.array(grantWriteSchema).max(20),
  })
  .superRefine(refineRestrictedPermissions);
export interface ApiKeyTrpcCreateInputSchema extends Named<
  typeof apiKeyTrpcCreateInputSchemaDefinition
> {}
export const apiKeyTrpcCreateInputSchema: ApiKeyTrpcCreateInputSchema =
  apiKeyTrpcCreateInputSchemaDefinition;
export type ApiKeyTrpcCreateInput = z.infer<typeof apiKeyTrpcCreateInputSchema>;

const apiKeyTrpcUpdateInputSchemaDefinition = z
  .object({
    organizationId: z.string(),
    apiKeyId: z.string(),
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullish(),
    permissionMode: z.enum(API_KEY_PERMISSION_MODES).optional(),
    permissions: z.array(apiKeyPermissionFormatSchema).optional(),
    bindings: z.array(grantWriteSchema).min(1).max(20).optional(),
  })
  .superRefine(refineRestrictedPermissions);
export interface ApiKeyTrpcUpdateInputSchema extends Named<
  typeof apiKeyTrpcUpdateInputSchemaDefinition
> {}
export const apiKeyTrpcUpdateInputSchema: ApiKeyTrpcUpdateInputSchema =
  apiKeyTrpcUpdateInputSchemaDefinition;

const apiKeyTrpcRevokeInputSchemaDefinition = z.object({
  organizationId: z.string(),
  apiKeyId: z.string(),
});
export interface ApiKeyTrpcRevokeInputSchema extends Named<
  typeof apiKeyTrpcRevokeInputSchemaDefinition
> {}
export const apiKeyTrpcRevokeInputSchema: ApiKeyTrpcRevokeInputSchema =
  apiKeyTrpcRevokeInputSchemaDefinition;
