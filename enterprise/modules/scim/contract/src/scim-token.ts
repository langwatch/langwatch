import { z } from "zod";

export type ScimTokenEntitlement =
  | { status: "invalid_token" }
  | { status: "plan_not_entitled"; organizationId: string; connectionId: string | null }
  | { status: "ok"; id: string; organizationId: string; connectionId: string | null };

/** One token as the settings page lists it. Never the token value itself. */
export const scimTokenSummarySchema = z
  .object({
    id: z.string(),
    connectionId: z.string().nullable(),
    description: z.string().nullable(),
    createdAt: z.date(),
    lastUsedAt: z.date().nullable(),
  })
  .strict();

export type ScimTokenSummary = z.infer<typeof scimTokenSummarySchema>;

export interface ScimTokenRecord extends ScimTokenSummary {
  organizationId: string;
}

/**
 * A newly minted token: the one moment its value exists outside the database.
 * No read ever answers it again, so a caller who loses it revokes and mints.
 */
export const issuedScimTokenSchema = z
  .object({ token: z.string(), tokenId: z.string(), connectionId: z.string() })
  .strict();

export type IssuedScimToken = z.infer<typeof issuedScimTokenSchema>;

/** A retirement acknowledged. The directory it belonged to stops provisioning. */
export const scimTokenRevokedSchema = z.object({ success: z.literal(true) }).strict();

/** The organization a token question is asked about. */
export const scimTokenScopeSchema = z.object({ organizationId: z.string() });

/**
 * One directory connection a token can be minted against, as the settings page
 * offers it. Identity owns the rows; `state` is identity's lifecycle word, and
 * which of them may carry a token is the page's reading of it.
 */
export const scimDirectoryConnectionSchema = z
  .object({
    connectionId: z.string(),
    displayName: z.string(),
    /** The protocol identity recorded at registration, so the picker can call
     *  a connection SAML or OIDC rather than leaving it unnamed. */
    type: z.string(),
    state: z.string(),
  })
  .strict();

export type ScimDirectoryConnection = z.infer<typeof scimDirectoryConnectionSchema>;

/**
 * What minting asks for. `connectionId` is optional on the wire and required
 * by the application, so a client that has not been updated reads the named
 * `scim_connection_required` refusal rather than a schema error.
 */
export const generateScimTokenSchema = z.object({
  ...scimTokenScopeSchema.shape,
  description: z.string().optional(),
  connectionId: z.string().optional(),
});

/** Which of the organization's tokens is retired. */
export const revokeScimTokenSchema = z.object({
  ...scimTokenScopeSchema.shape,
  tokenId: z.string(),
});
