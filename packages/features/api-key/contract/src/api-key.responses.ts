/**
 * What the `apiKey.*` surface answers, as schemas.
 *
 * The rule `api-key.list.ts` writes down holds here too: NO KEY MATERIAL is
 * on any read.
 * The plaintext token appears in exactly one shape below — the answer of
 * `apiKey.create`, at the moment of minting — and every other schema carries
 * the five-character public `lookupIdPrefix` and nothing more.
 */
import { z } from "zod";

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
export type ApiKeyMinted = z.infer<typeof apiKeyMintedSchema>;

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
