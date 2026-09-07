/**
 * One API key row, as the Settings > API Keys table reads it.
 *
 * This is the answer of `apiKey.list`, written down here as the schema the
 * transport validates against and the type inferred from it. Before
 * the family moved out of `platform/app`, the page typed its rows as
 * `RouterOutputs["apiKey"]["list"][number]` — the whole shape derived from an
 * `AppRouter` a browser package may not name. The producer is PACKAGED
 * (`@langwatch/api-key-server`'s `ApiKeyApp.listKeys`), so the ruling on
 * contract moves allows the real fix rather than a restatement: the app method
 * is ANNOTATED with this type, and both halves are now checked against one
 * declaration — the same one the tRPC output schema enforces at runtime.
 *
 * ## NO KEY MATERIAL IS ON THIS SHAPE, and that is the point of writing it down
 *
 * `lookupIdPrefix` is five characters of the key's LOOKUP id — the public half
 * that identifies which row a presented credential belongs to. It is not a
 * prefix of the secret. The plaintext token exists in exactly one answer in this
 * feature, `apiKey.create`, at the moment of minting; every read hands back this
 * row and nothing more. Widening this type with a token, a hash, or the full
 * lookup id would turn a list request into a credential disclosure, which is why
 * the rule is stated here rather than left to the projection that happens to
 * satisfy it today.
 */

import { z } from "zod";
import { apiKeyBindingSchema, type ApiKeyBinding } from "./api-key.ts";

/**
 * One of the CALLER's own bindings, with the scope named rather than only
 * identified. The answer of `apiKey.myBindings`, which both drawers and the CLI
 * authorize screen read to work out the ceiling a new key may be given.
 *
 * Declared here rather than in `@langwatch/api-key-server` — where it lived,
 * with no consumer outside that package's own barrel — because a browser
 * package may not import a server one, and this is a DTO rather than anything
 * the server owns.
 */
export const namedApiKeyBindingSchema = apiKeyBindingSchema
  .extend({
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
