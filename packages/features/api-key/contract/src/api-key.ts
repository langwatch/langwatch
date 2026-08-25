import { z } from "zod";

export const apiKeyRoleSchema = z.enum(["ADMIN", "MEMBER", "VIEWER", "CUSTOM"]);
export type ApiKeyRole = z.infer<typeof apiKeyRoleSchema>;
export const apiKeyScopeTypeSchema = z.enum(["ORGANIZATION", "TEAM", "PROJECT"]);
export type ApiKeyScopeType = z.infer<typeof apiKeyScopeTypeSchema>;
export const apiKeyPermissionSchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9_-]*:[a-z][a-zA-Z0-9_-]*$/);
export const apiKeyScopeSchema = z.object({
  scopeType: apiKeyScopeTypeSchema,
  scopeId: z.string().min(1),
  role: apiKeyRoleSchema,
  customRoleId: z.string().min(1).nullable().optional(),
}).strict();
export type ApiKeyScope = z.infer<typeof apiKeyScopeSchema>;
export const apiKeyBindingSchema = apiKeyScopeSchema.extend({ id: z.string().min(1) }).strict();
export type ApiKeyBinding = Omit<z.infer<typeof apiKeyBindingSchema>, "customRoleId"> & {
  customRoleId: string | null;
};
export const apiKeyPermissionModeSchema = z.enum(["all", "readonly", "restricted"]);
export type ApiKeyPermissionMode = z.infer<typeof apiKeyPermissionModeSchema>;

export const apiKeySchema = z.object({
  id: z.string().min(1), name: z.string(), description: z.string().nullable(),
  organizationId: z.string().min(1), userId: z.string().nullable(),
  createdByUserId: z.string().nullable(), createdByDeviceLabel: z.string().nullable(),
  lookupId: z.string().min(1), permissionMode: z.string(), expiresAt: z.date().nullable(),
  revokedAt: z.date().nullable(), lastUsedAt: z.date().nullable(),
  ingestSourceType: z.string().nullable(), ingestionTemplateId: z.string().nullable(),
  createdAt: z.date(), updatedAt: z.date(), roleBindings: z.array(apiKeyBindingSchema),
}).strict();
export type ApiKey = z.infer<typeof apiKeySchema>;

const apiKeyMutationShape = {
  name: z.string().min(1), organizationId: z.string().min(1),
  userId: z.string().min(1).nullable().optional(), createdByUserId: z.string().min(1).nullable().optional(),
  description: z.string().nullable().optional(), expiresAt: z.date().nullable().optional(),
  permissionMode: z.string().default("all"), permissions: z.array(apiKeyPermissionSchema).optional(),
  bindings: z.array(apiKeyScopeSchema), ingestSourceType: z.string().min(1).nullable().optional(),
  ingestionTemplateId: z.string().min(1).nullable().optional(), createdByDeviceLabel: z.string().nullable().optional(),
  isSystemManaged: z.boolean().optional(),
};
export const createApiKeyInputSchema = z.object(apiKeyMutationShape).strict();
export type CreateApiKeyInput = z.input<typeof createApiKeyInputSchema>;
export const updateApiKeyInputSchema = z.object({
  id: z.string().min(1), organizationId: z.string().min(1), callerUserId: z.string().min(1).nullable(), callerIsAdmin: z.boolean(),
  name: z.string().min(1).optional(), description: z.string().nullable().optional(), permissionMode: z.string().optional(),
  permissions: z.array(apiKeyPermissionSchema).optional(), bindings: z.array(apiKeyScopeSchema).optional(),
}).strict();
export type UpdateApiKeyInput = z.infer<typeof updateApiKeyInputSchema>;
export const revokeApiKeyInputSchema = z.object({
  id: z.string().min(1), organizationId: z.string().min(1), callerUserId: z.string().min(1).nullable(), callerIsAdmin: z.boolean(), awaitProjection: z.boolean().optional(),
}).strict();
export type RevokeApiKeyInput = z.infer<typeof revokeApiKeyInputSchema>;
export const apiKeyVerificationSchema = apiKeySchema.extend({ tokenType: z.literal("apiKey") });
export type ApiKeyVerification = z.infer<typeof apiKeyVerificationSchema>;
export const apiKeyDetailSchema = apiKeySchema.extend({ permissions: z.array(apiKeyPermissionSchema) });
export type ApiKeyDetail = z.infer<typeof apiKeyDetailSchema>;
export type ApiKeyName = { name: string; revoked: boolean };
export type ApiKeyUser = { id: string; name: string | null; email: string | null };
export type ApiKeyProject = { id: string; name: string; teamId: string };
export type ApiKeyTeam = { id: string; name: string };
export type ApiKeyRoleSummary = {
  id: string;
  name: string;
  permissions: string[];
};
export type ApiKeyBindingNames = { orgName: Map<string, string>; teamName: Map<string, string>; activeProjectIds: Set<string>; projectName: Map<string, string>; customRoleName: Map<string, string>; customRoles: ApiKeyRoleSummary[] };
export type ApiKeyListEnrichment = { customRoles: ApiKeyRoleSummary[]; users: ApiKeyUser[] };
export type ApiKeyCreatorScope = { type: "org"; id: string } | { type: "team"; id: string } | { type: "project"; id: string; teamId: string };
export const cliKeyBindingSelectionSchema = z.object({ scopeType: apiKeyScopeTypeSchema, scopeId: z.string().min(1) }).strict();
export type CliKeyBindingSelection = z.infer<typeof cliKeyBindingSelectionSchema>;
export const cliKeySelectionSchema = z.object({ bindings: z.array(cliKeyBindingSelectionSchema), permissions: z.array(apiKeyPermissionSchema) }).strict();
export type CliKeySelection = z.infer<typeof cliKeySelectionSchema>;
export const cliKeyScopeSummarySchema = z.object({ kind: z.enum(["organization", "projects"]), projectIds: z.array(z.string().min(1)) }).strict();
export type CliKeyScopeSummary = z.infer<typeof cliKeyScopeSummarySchema>;
