import type { Named } from "@langwatch/module";
/**
 * What the `apiKey.*` surface answers, as schemas. No key material on any read:
 * the plaintext token appears only in `apiKeyMintedSchema`, at minting time.
 */
import { z } from "zod";

/** One key id resolved to a name. Null for an id this caller cannot see. */
const apiKeyNameSchemaDefinition = z.object({ name: z.string(), revoked: z.boolean() }).strict();
export interface ApiKeyNameSchema extends Named<typeof apiKeyNameSchemaDefinition> {}
export const apiKeyNameSchema: ApiKeyNameSchema = apiKeyNameSchemaDefinition;

/** A member of the organization, for assigning a key to one of them. */
const apiKeyUserSchemaDefinition = z
  .object({ id: z.string(), name: z.string().nullable(), email: z.string().nullable() })
  .strict();
export interface ApiKeyUserSchema extends Named<typeof apiKeyUserSchemaDefinition> {}
export const apiKeyUserSchema: ApiKeyUserSchema = apiKeyUserSchemaDefinition;

/** A project in the organization, for the restricted-permission picker. */
const apiKeyProjectSchemaDefinition = z
  .object({ id: z.string(), name: z.string(), teamId: z.string() })
  .strict();
export interface ApiKeyProjectSchema extends Named<typeof apiKeyProjectSchemaDefinition> {}
export const apiKeyProjectSchema: ApiKeyProjectSchema = apiKeyProjectSchemaDefinition;

/** A team in the organization, for the scope picker. */
const apiKeyTeamSchemaDefinition = z.object({ id: z.string(), name: z.string() }).strict();
export interface ApiKeyTeamSchema extends Named<typeof apiKeyTeamSchemaDefinition> {}
export const apiKeyTeamSchema: ApiKeyTeamSchema = apiKeyTeamSchemaDefinition;

/**
 * The one answer that carries the plaintext token, returned once at the moment
 * of minting. Nothing stores it and no read returns it again.
 */
const apiKeyMintedSchemaDefinition = z
  .object({
    token: z.string(),
    apiKey: z.object({ id: z.string(), name: z.string(), createdAt: z.date() }).strict(),
  })
  .strict();
export interface ApiKeyMintedSchema extends Named<typeof apiKeyMintedSchemaDefinition> {}
export const apiKeyMintedSchema: ApiKeyMintedSchema = apiKeyMintedSchemaDefinition;

/** What an edit answers: the row's identity and the mode it now runs under. */
const apiKeyUpdatedSchemaDefinition = z
  .object({
    id: z.string(),
    name: z.string(),
    permissionMode: z.string(),
  })
  .strict();
export interface ApiKeyUpdatedSchema extends Named<typeof apiKeyUpdatedSchemaDefinition> {}
export const apiKeyUpdatedSchema: ApiKeyUpdatedSchema = apiKeyUpdatedSchemaDefinition;

/** A retirement acknowledged. */
const apiKeyRevokedSchemaDefinition = z.object({ success: z.boolean() }).strict();
export interface ApiKeyRevokedSchema extends Named<typeof apiKeyRevokedSchemaDefinition> {}
export const apiKeyRevokedSchema: ApiKeyRevokedSchema = apiKeyRevokedSchemaDefinition;
