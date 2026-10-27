import type { Named } from "@langwatch/module";
import { z } from "zod";

import { API_KEY_REVOCATION_CAUSES } from "./api-key.revocation-cause.ts";

export const apiKeyRoleSchema = z.enum(["ADMIN", "MEMBER", "VIEWER", "CUSTOM"]);
export type ApiKeyRole = z.infer<typeof apiKeyRoleSchema>;
export const apiKeyScopeTypeSchema = z.enum(["ORGANIZATION", "TEAM", "PROJECT"]);
export type ApiKeyScopeType = z.infer<typeof apiKeyScopeTypeSchema>;
export const apiKeyPermissionFormatSchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9_-]*:[a-z][a-zA-Z0-9_-]*$/);
const apiKeyScopeSchemaDefinition = z
  .object({
    scopeType: apiKeyScopeTypeSchema,
    scopeId: z.string().min(1),
    role: apiKeyRoleSchema,
    customRoleId: z.string().min(1).nullable().optional(),
  })
  .strict();
export interface ApiKeyScopeSchema extends Named<typeof apiKeyScopeSchemaDefinition> {}
export const apiKeyScopeSchema: ApiKeyScopeSchema = apiKeyScopeSchemaDefinition;
export type ApiKeyScope = z.infer<typeof apiKeyScopeSchema>;
const apiKeyBindingSchemaDefinition = z
  .object({ ...apiKeyScopeSchema.shape, id: z.string().min(1) })
  .strict();
export interface ApiKeyBindingSchema extends Named<typeof apiKeyBindingSchemaDefinition> {}
export const apiKeyBindingSchema: ApiKeyBindingSchema = apiKeyBindingSchemaDefinition;
export type ApiKeyBinding = Omit<z.infer<typeof apiKeyBindingSchema>, "customRoleId"> & {
  customRoleId: string | null;
};
export const apiKeyPermissionModeSchema = z.enum(["all", "readonly", "restricted"]);
export type ApiKeyPermissionMode = z.infer<typeof apiKeyPermissionModeSchema>;

const apiKeySchemaDefinition = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    description: z.string().nullable(),
    organizationId: z.string().min(1),
    userId: z.string().nullable(),
    createdByUserId: z.string().nullable(),
    createdByDeviceLabel: z.string().nullable(),
    /**
     * The CLI login key of the device session that minted this key. Set by
     * the CLI's personal mint, null otherwise. Revoking the parent (logout,
     * devices tab, re-login, session expiry) revokes the children with it.
     */
    parentApiKeyId: z.string().nullable().optional(),
    lookupId: z.string().min(1),
    permissionMode: z.string(),
    expiresAt: z.date().nullable(),
    revokedAt: z.date().nullable(),
    /**
     * Why the key was revoked; empty while live, or for a row revoked before
     * the cause was recorded. A plain string — the stored value is whatever
     * the build that wrote it knew; narrow with {@link isApiKeyRevocationCause}.
     */
    revocationCause: z.string().nullable().optional(),
    lastUsedAt: z.date().nullable(),
    ingestSourceType: z.string().nullable(),
    ingestionTemplateId: z.string().nullable(),
    /** Minted by LangWatch for itself (a run, the gateway, Langy), never by a customer. */
    isSystemManaged: z.boolean().optional(),
    createdAt: z.date(),
    updatedAt: z.date(),
    grants: z.array(apiKeyBindingSchema),
  })
  .strict();
export interface ApiKeySchema extends Named<typeof apiKeySchemaDefinition> {}
export const apiKeySchema: ApiKeySchema = apiKeySchemaDefinition;
export type ApiKey = z.infer<typeof apiKeySchema>;

const apiKeyMutationShape = {
  name: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1).nullable().optional(),
  createdByUserId: z.string().min(1).nullable().optional(),
  /** The organization key making the request, which bounds every binding it grants. */
  callerApiKeyId: z.string().min(1).nullable().optional(),
  description: z.string().nullable().optional(),
  expiresAt: z.date().nullable().optional(),
  permissionMode: z.string().default("all"),
  permissions: z.array(apiKeyPermissionFormatSchema).optional(),
  bindings: z.array(apiKeyScopeSchema),
  ingestSourceType: z.string().min(1).nullable().optional(),
  ingestionTemplateId: z.string().min(1).nullable().optional(),
  createdByDeviceLabel: z.string().nullable().optional(),
  /**
   * The CLI login key of the device session minting this ingestion key, so
   * revoking that session revokes this key with it. Null (the default) for
   * every key minted outside a CLI session.
   */
  parentApiKeyId: z.string().min(1).nullable().optional(),
  isSystemManaged: z.boolean().optional(),
};
const createApiKeyInputSchemaDefinition = z.object(apiKeyMutationShape).strict();
export interface CreateApiKeyInputSchema extends Named<typeof createApiKeyInputSchemaDefinition> {}
export const createApiKeyInputSchema: CreateApiKeyInputSchema = createApiKeyInputSchemaDefinition;
export type CreateApiKeyInput = z.input<typeof createApiKeyInputSchema>;
const updateApiKeyInputSchemaDefinition = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    callerUserId: z.string().min(1).nullable(),
    callerApiKeyId: z.string().min(1).nullable().optional(),
    callerIsAdmin: z.boolean(),
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    permissionMode: z.string().optional(),
    permissions: z.array(apiKeyPermissionFormatSchema).optional(),
    bindings: z.array(apiKeyScopeSchema).optional(),
  })
  .strict();
export interface UpdateApiKeyInputSchema extends Named<typeof updateApiKeyInputSchemaDefinition> {}
export const updateApiKeyInputSchema: UpdateApiKeyInputSchema = updateApiKeyInputSchemaDefinition;
export type UpdateApiKeyInput = z.infer<typeof updateApiKeyInputSchema>;
const revokeApiKeyInputSchemaDefinition = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    callerUserId: z.string().min(1).nullable(),
    callerIsAdmin: z.boolean(),
    awaitProjection: z.boolean().optional(),
    /**
     * Why the key dies, recorded on the row. Defaults to a person's
     * decision (every user-facing path); the platform's own revocations
     * name themselves so the CLI can tell a re-mintable key from a dead one.
     */
    cause: z.enum(API_KEY_REVOCATION_CAUSES).optional(),
    /**
     * Whether to retire the keys minted under this one. On by default so
     * every entry point cascades; the cascade turns it off for the children
     * it revokes, since nothing should recurse past one level.
     */
    cascadeToChildren: z.boolean().optional(),
  })
  .strict();
export interface RevokeApiKeyInputSchema extends Named<typeof revokeApiKeyInputSchemaDefinition> {}
export const revokeApiKeyInputSchema: RevokeApiKeyInputSchema = revokeApiKeyInputSchemaDefinition;
export type RevokeApiKeyInput = z.infer<typeof revokeApiKeyInputSchema>;
const apiKeyVerificationSchemaDefinition = z
  .object({ ...apiKeySchema.shape, tokenType: z.literal("apiKey") })
  .strict();
export interface ApiKeyVerificationSchema extends Named<
  typeof apiKeyVerificationSchemaDefinition
> {}
export const apiKeyVerificationSchema: ApiKeyVerificationSchema =
  apiKeyVerificationSchemaDefinition;
export type ApiKeyVerification = z.infer<typeof apiKeyVerificationSchema>;
const apiKeyDetailSchemaDefinition = z
  .object({ ...apiKeySchema.shape, permissions: z.array(apiKeyPermissionFormatSchema) })
  .strict();
export interface ApiKeyDetailSchema extends Named<typeof apiKeyDetailSchemaDefinition> {}
export const apiKeyDetailSchema: ApiKeyDetailSchema = apiKeyDetailSchemaDefinition;
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
export type ApiKeyBindingNames = {
  orgName: Map<string, string>;
  teamName: Map<string, string>;
  activeProjectIds: Set<string>;
  projectName: Map<string, string>;
  customRoleName: Map<string, string>;
  customRoles: ApiKeyRoleSummary[];
};
export type ApiKeyListEnrichment = {
  customRoles: ApiKeyRoleSummary[];
  users: ApiKeyUser[];
};
export type ApiKeyCreatorScope =
  | { type: "org"; id: string }
  | { type: "team"; id: string }
  | { type: "project"; id: string; teamId: string };
const cliKeyBindingSelectionSchemaDefinition = z
  .object({ scopeType: apiKeyScopeTypeSchema, scopeId: z.string().min(1) })
  .strict();
export interface CliKeyBindingSelectionSchema extends Named<
  typeof cliKeyBindingSelectionSchemaDefinition
> {}
export const cliKeyBindingSelectionSchema: CliKeyBindingSelectionSchema =
  cliKeyBindingSelectionSchemaDefinition;
export type CliKeyBindingSelection = z.infer<typeof cliKeyBindingSelectionSchema>;
const cliKeySelectionSchemaDefinition = z
  .object({
    bindings: z.array(cliKeyBindingSelectionSchema),
    permissions: z.array(apiKeyPermissionFormatSchema),
  })
  .strict();
export interface CliKeySelectionSchema extends Named<typeof cliKeySelectionSchemaDefinition> {}
export const cliKeySelectionSchema: CliKeySelectionSchema = cliKeySelectionSchemaDefinition;
export type CliKeySelection = z.infer<typeof cliKeySelectionSchema>;
const cliKeyScopeSummarySchemaDefinition = z
  .object({
    kind: z.enum(["organization", "projects"]),
    projectIds: z.array(z.string().min(1)),
    /**
     * The permissions the key was actually minted with, so `whoami` can print
     * the grain the exchange handed out rather than the caller having to guess
     * it from the scope kind.
     */
    permissions: z.array(z.string().min(1)),
  })
  .strict();
export interface CliKeyScopeSummarySchema extends Named<
  typeof cliKeyScopeSummarySchemaDefinition
> {}
export const cliKeyScopeSummarySchema: CliKeyScopeSummarySchema =
  cliKeyScopeSummarySchemaDefinition;
export type CliKeyScopeSummary = z.infer<typeof cliKeyScopeSummarySchema>;

/** Input shapes of the ApiKeyApi operations. */
export type ApiKeySelectionInput = {
  userId: string;
  organizationId: string;
  bindings: (ApiKeyScope & { role: "CUSTOM" })[];
  permissions: string[];
};
export type ApiKeyListInput = { userId: string; organizationId: string };
export type ApiKeyListAllInput = { organizationId: string };
export type ApiKeyVerifyInput = { token: string };
export type ApiKeyOrgInput = { organizationId: string };
export type ApiKeyIdInput = { id: string };
export type ApiKeyOrgIdInput = { id: string; organizationId: string };
export type ApiKeyMembershipInput = { userId: string; organizationId: string };
export type ApiKeyAdminKeyInput = { apiKeyId: string; organizationId: string };
export type ApiKeyCallerReadInput = {
  id: string;
  organizationId: string;
  callerUserId: string | null;
  callerCanReadAnyKey: boolean;
};
