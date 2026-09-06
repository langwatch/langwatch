/**
 * What the `apiKey.*` surface answers, as schemas.
 *
 * The rule `api-key.list.ts` writes down holds here too and is the reason
 * these are declared rather than inferred: NO KEY MATERIAL is on any read.
 * The plaintext token appears in exactly one shape below — the answer of
 * `apiKey.create`, at the moment of minting — and every other schema carries
 * the five-character public `lookupIdPrefix` and nothing more.
 */
import { z } from "zod";

import { apiKeyBindingSchema } from "./api-key.ts";
import type { ApiKeyListEntry, ApiKeyListRoleBinding, NamedApiKeyBinding } from "./api-key.list.ts";

/** One of the caller's own bindings, with its scope named. */
export const namedApiKeyBindingSchema: z.ZodType<NamedApiKeyBinding> = apiKeyBindingSchema
  .extend({
    customRoleId: z.string().nullable(),
    scopeName: z.string().nullable(),
    customRoleName: z.string().nullable(),
  })
  .strict();

/** One role binding on a listed key, with the names its row renders. */
const apiKeyListRoleBindingSchema: z.ZodType<ApiKeyListRoleBinding> = z
  .object({
    id: z.string(),
    role: z.string(),
    customRoleId: z.string().nullable(),
    customRoleName: z.string().nullable(),
    customRolePermissions: z.array(z.string()).nullable(),
    scopeType: z.string(),
    scopeId: z.string(),
    scopeName: z.string().nullable(),
  })
  .strict();

/** One API key row, as every read of the feature answers it. */
export const apiKeyListEntrySchema: z.ZodType<ApiKeyListEntry> = z
  .object({
    id: z.string(),
    lookupIdPrefix: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    permissionMode: z.string(),
    userId: z.string().nullable(),
    userName: z.string().nullable(),
    userEmail: z.string().nullable(),
    createdByUserId: z.string().nullable(),
    createdByUserName: z.string().nullable(),
    createdAt: z.date(),
    expiresAt: z.date().nullable(),
    lastUsedAt: z.date().nullable(),
    revokedAt: z.date().nullable(),
    ingestSourceType: z.string().nullable(),
    ingestionTemplateId: z.string().nullable(),
    createdByDeviceLabel: z.string().nullable(),
    roleBindings: z.array(apiKeyListRoleBindingSchema),
  })
  .strict();

/** One key id resolved to a name. Null for an id this caller cannot see. */
export const apiKeyNameSchema = z.object({ name: z.string(), revoked: z.boolean() }).strict();

/** A member of the organization, for assigning a key to one of them. */
export const apiKeyUserSchema = z
  .object({ id: z.string(), name: z.string().nullable(), email: z.string().nullable() })
  .strict();

/** A project in the organization, for the restricted-permission picker. */
export const apiKeyProjectSchema = z
  .object({ id: z.string(), name: z.string(), teamId: z.string() })
  .strict();

/** A team in the organization, for the scope picker. */
export const apiKeyTeamSchema = z.object({ id: z.string(), name: z.string() }).strict();

/**
 * The one answer that carries the plaintext token, returned once at the moment
 * of minting. Nothing stores it and no read returns it again.
 */
export const apiKeyMintedSchema = z
  .object({
    token: z.string(),
    apiKey: z.object({ id: z.string(), name: z.string(), createdAt: z.date() }).strict(),
  })
  .strict();

/** What an edit answers: the row's identity and the mode it now runs under. */
export const apiKeyUpdatedSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    permissionMode: z.string(),
  })
  .strict();

/** A retirement acknowledged. */
export const apiKeyRevokedSchema = z.object({ success: z.boolean() }).strict();
