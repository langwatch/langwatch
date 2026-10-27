import type { Named } from "@langwatch/module";
import { z } from "zod";

export type ScimTokenEntitlement =
  | { status: "invalid_token" }
  | { status: "plan_not_entitled"; organizationId: string; connectionId: string | null }
  | { status: "ok"; id: string; organizationId: string; connectionId: string | null };

/** One token as the settings page lists it. Never the token value itself. */
const scimTokenSummarySchemaDefinition = z
  .object({
    id: z.string(),
    connectionId: z.string().nullable(),
    description: z.string().nullable(),
    createdAt: z.date(),
    lastUsedAt: z.date().nullable(),
  })
  .strict();
export interface ScimTokenSummarySchema extends Named<typeof scimTokenSummarySchemaDefinition> {}
export const scimTokenSummarySchema: ScimTokenSummarySchema = scimTokenSummarySchemaDefinition;

export type ScimTokenSummary = z.infer<typeof scimTokenSummarySchema>;

export interface ScimTokenRecord extends ScimTokenSummary {
  organizationId: string;
}

/**
 * A newly minted token: the one moment its value exists outside the database.
 * No read ever answers it again, so a caller who loses it revokes and mints.
 */
const issuedScimTokenSchemaDefinition = z
  .object({ token: z.string(), tokenId: z.string(), connectionId: z.string() })
  .strict();
export interface IssuedScimTokenSchema extends Named<typeof issuedScimTokenSchemaDefinition> {}
export const issuedScimTokenSchema: IssuedScimTokenSchema = issuedScimTokenSchemaDefinition;

export type IssuedScimToken = z.infer<typeof issuedScimTokenSchema>;

/** A retirement acknowledged. The directory it belonged to stops provisioning. */
const scimTokenRevokedSchemaDefinition = z.object({ success: z.literal(true) }).strict();
export interface ScimTokenRevokedSchema extends Named<typeof scimTokenRevokedSchemaDefinition> {}
export const scimTokenRevokedSchema: ScimTokenRevokedSchema = scimTokenRevokedSchemaDefinition;

/** The organization a token question is asked about. */
const scimTokenScopeSchemaDefinition = z.object({ organizationId: z.string() });
export interface ScimTokenScopeSchema extends Named<typeof scimTokenScopeSchemaDefinition> {}
export const scimTokenScopeSchema: ScimTokenScopeSchema = scimTokenScopeSchemaDefinition;

/**
 * One directory connection a token can be minted against, as the settings page
 * offers it. Identity owns the rows; `state` is identity's lifecycle word, and
 * which of them may carry a token is the page's reading of it.
 */
const scimDirectoryConnectionSchemaDefinition = z
  .object({
    connectionId: z.string(),
    displayName: z.string(),
    /** The protocol identity recorded at registration, so the picker can call
     *  a connection SAML or OIDC rather than leaving it unnamed. */
    type: z.string(),
    state: z.string(),
  })
  .strict();
export interface ScimDirectoryConnectionSchema extends Named<
  typeof scimDirectoryConnectionSchemaDefinition
> {}
export const scimDirectoryConnectionSchema: ScimDirectoryConnectionSchema =
  scimDirectoryConnectionSchemaDefinition;

export type ScimDirectoryConnection = z.infer<typeof scimDirectoryConnectionSchema>;

/**
 * What minting asks for. `connectionId` is optional on the wire and required
 * by the application, so a client that has not been updated reads the named
 * `scim_connection_required` refusal rather than a schema error.
 */
const generateScimTokenSchemaDefinition = z.object({
  ...scimTokenScopeSchema.shape,
  description: z.string().optional(),
  connectionId: z.string().optional(),
  /** A value the administrator already holds; floored by the service, capped here. */
  secret: z.string().max(512).optional(),
});
export interface GenerateScimTokenSchema extends Named<typeof generateScimTokenSchemaDefinition> {}
export const generateScimTokenSchema: GenerateScimTokenSchema = generateScimTokenSchemaDefinition;

/** Which of the organization's tokens is retired. */
const revokeScimTokenSchemaDefinition = z.object({
  ...scimTokenScopeSchema.shape,
  tokenId: z.string(),
});
export interface RevokeScimTokenSchema extends Named<typeof revokeScimTokenSchemaDefinition> {}
export const revokeScimTokenSchema: RevokeScimTokenSchema = revokeScimTokenSchemaDefinition;
