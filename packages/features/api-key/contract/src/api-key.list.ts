/**
 * One API key row, as the Settings > API Keys table reads it. See ADR-001
 * (../adrs/001-api-key-service.md) for why the shape lives in the contract.
 *
 * NO KEY MATERIAL is on this shape: `lookupIdPrefix` is five characters of the
 * key's public lookup id, never part of the secret. The plaintext token leaves
 * the server exactly once, in `apiKey.create` at the moment of minting.
 */

import { z } from "zod";
import { apiKeyBindingSchema, type ApiKeyBinding } from "./api-key.ts";

/**
 * One of the CALLER's own bindings, with the scope named rather than only
 * identified. The answer of `apiKey.myBindings`, which the drawers and the CLI
 * authorize screen read to work out the ceiling a new key may be given.
 */
export const namedApiKeyBindingSchema = z
  .object({
    ...apiKeyBindingSchema.shape,
    customRoleId: z.string().nullable(),
    scopeName: z.string().nullable(),
    customRoleName: z.string().nullable(),
  })
  .strict();
export type NamedApiKeyBinding = ApiKeyBinding & z.infer<typeof namedApiKeyBindingSchema>;

/** One role binding on a key, with the names its row renders. */
export const apiKeyListRoleBindingSchema = z
  .object({
    id: z.string(),
    role: z.string(),
    customRoleId: z.string().nullable(),
    /** The custom role's display name, when the binding names one. */
    customRoleName: z.string().nullable(),
    /** The custom role's permission list, which the edit drawer reads back. */
    customRolePermissions: z.array(z.string()).nullable(),
    scopeType: z.string(),
    scopeId: z.string(),
    /** The organization, team or project name the scope id resolves to. */
    scopeName: z.string().nullable(),
  })
  .strict();
export type ApiKeyListRoleBinding = z.infer<typeof apiKeyListRoleBindingSchema>;

/**
 * One API key, as every read of the feature answers it.
 *
 * The four timestamps are `z.date()` because this is the shape tRPC serialises:
 * the browser receives them as ISO strings through `WireOf<ApiKeyListEntry>`,
 * and the server still constructs real dates at the Prisma seam.
 */
export const apiKeyListEntrySchema = z
  .object({
    id: z.string(),
    /** Five characters of the PUBLIC lookup id. Never any part of the secret. */
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
    /**
     * Non-null marks this as an ingestion key: a project-scoped, ingest-only
     * write credential the `langwatch <tool>` CLI mints. `null` is a regular
     * personal or service key. The API Keys page renders the two in separate
     * sections on this field alone.
     */
    ingestSourceType: z.string().nullable(),
    ingestionTemplateId: z.string().nullable(),
    /** Human label of the CLI device session that minted an ingestion key. */
    createdByDeviceLabel: z.string().nullable(),
    roleBindings: z.array(apiKeyListRoleBindingSchema),
  })
  .strict();
export type ApiKeyListEntry = z.infer<typeof apiKeyListEntrySchema>;
