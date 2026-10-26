/**
 * Docs session keys (ADR-185, dev/docs/adr/185-docs-session-credentials.md): a five-minute key
 * the documentation playground holds in memory, acting as one member in one project.
 * The consent page, the mint and the revocation all speak the shapes below.
 */
import { HandledError, remediation } from "@langwatch/handled-error";
import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The longest a docs session key lives; the browser session or the ceiling may end it sooner. */
export const DOCS_SESSION_KEY_LIFETIME_MS = 5 * 60 * 1000;

/** The `type` of every message the consent popup posts to the docs. */
export const DOCS_SESSION_MESSAGE_TYPE = "langwatch:docs-session" as const;
export const DOCS_SESSION_MESSAGE_VERSION = 1 as const;

/** The docs' single-use `state`: 256 random bits, base64url without padding (43 characters). */
export const DOCS_SESSION_STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const docsOriginSchema = z.string().min(1).max(2048);

/** What the consent page sends when the member allows access. */
const apiKeyTrpcMintDocsSessionKeyInputSchemaDefinition = z
  .object({ projectId: z.string().min(1), docsOrigin: docsOriginSchema })
  .strict();
export interface ApiKeyTrpcMintDocsSessionKeyInputSchema extends Named<
  typeof apiKeyTrpcMintDocsSessionKeyInputSchemaDefinition
> {}
export const apiKeyTrpcMintDocsSessionKeyInputSchema: ApiKeyTrpcMintDocsSessionKeyInputSchema =
  apiKeyTrpcMintDocsSessionKeyInputSchemaDefinition;

/** The one-time answer: the token, when it dies, and the project it acts in. */
const docsSessionKeyMintedSchemaDefinition = z
  .object({
    token: z.string().min(1),
    expiresAt: z.iso.datetime(),
    project: z.object({ id: z.string().min(1), name: z.string() }).strict(),
  })
  .strict();
export interface DocsSessionKeyMintedSchema extends Named<
  typeof docsSessionKeyMintedSchemaDefinition
> {}
export const docsSessionKeyMintedSchema: DocsSessionKeyMintedSchema =
  docsSessionKeyMintedSchemaDefinition;
export type DocsSessionKeyMinted = z.infer<typeof docsSessionKeyMintedSchema>;

/**
 * `ApiKeyApi.mintDocsSessionKey`: the verified caller, the browser session that asked and its
 * window (null for a caller on no browser session, which is refused), the chosen project and
 * the docs origin the key is handed to.
 */
const mintDocsSessionKeyInputSchemaDefinition = z
  .object({
    userId: z.string().min(1),
    impersonatorId: z.string().min(1).optional(),
    browserSession: z
      .object({
        id: z.string().min(1),
        startedAt: z.iso.datetime().nullable(),
        expiresAt: z.iso.datetime().nullable(),
      })
      .strict()
      .nullable(),
    projectId: z.string().min(1),
    docsOrigin: docsOriginSchema,
  })
  .strict();
export interface MintDocsSessionKeyInputSchema extends Named<
  typeof mintDocsSessionKeyInputSchemaDefinition
> {}
export const mintDocsSessionKeyInputSchema: MintDocsSessionKeyInputSchema =
  mintDocsSessionKeyInputSchemaDefinition;
export type MintDocsSessionKeyInput = z.infer<typeof mintDocsSessionKeyInputSchema>;

/**
 * `ApiKeyApi.revokeDocsSessionKeys`: the presenting key (Disconnect; null for a credential that
 * is no stored key), or every docs key the member's named browser sessions minted (sign-out).
 */
const revokeDocsSessionKeysInputSchemaDefinition = z.union([
  z.object({ apiKeyId: z.string().min(1).nullable() }).strict(),
  z.object({ userId: z.string().min(1), browserSessionIds: z.array(z.string().min(1)) }).strict(),
]);
export interface RevokeDocsSessionKeysInputSchema extends Named<
  typeof revokeDocsSessionKeysInputSchemaDefinition
> {}
export const revokeDocsSessionKeysInputSchema: RevokeDocsSessionKeysInputSchema =
  revokeDocsSessionKeysInputSchemaDefinition;
export type RevokeDocsSessionKeysInput = z.infer<typeof revokeDocsSessionKeysInputSchema>;

/**
 * What the consent popup posts to the docs window that opened it, at the docs' exact origin:
 * the minted key on Allow, or only the refusal on Deny. `state` echoes the docs' own nonce.
 */
const docsSessionMessageSchemaDefinition = z.discriminatedUnion("outcome", [
  z
    .object({
      type: z.literal(DOCS_SESSION_MESSAGE_TYPE),
      version: z.literal(DOCS_SESSION_MESSAGE_VERSION),
      state: z.string().regex(DOCS_SESSION_STATE_PATTERN),
      outcome: z.literal("granted"),
      token: z.string().min(1),
      expiresAt: z.iso.datetime(),
      project: z.object({ id: z.string().min(1), name: z.string() }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal(DOCS_SESSION_MESSAGE_TYPE),
      version: z.literal(DOCS_SESSION_MESSAGE_VERSION),
      state: z.string().regex(DOCS_SESSION_STATE_PATTERN),
      outcome: z.literal("denied"),
    })
    .strict(),
]);
export interface DocsSessionMessageSchema extends Named<
  typeof docsSessionMessageSchemaDefinition
> {}
export const docsSessionMessageSchema: DocsSessionMessageSchema =
  docsSessionMessageSchemaDefinition;
export type DocsSessionMessage = z.infer<typeof docsSessionMessageSchema>;

/** What `DELETE /api/docs-session` answers, whether or not there was a key to revoke. */
const docsSessionRevokedSchemaDefinition = z.object({ revoked: z.literal(true) }).strict();
export interface DocsSessionRevokedSchema extends Named<
  typeof docsSessionRevokedSchemaDefinition
> {}
export const docsSessionRevokedSchema: DocsSessionRevokedSchema =
  docsSessionRevokedSchemaDefinition;
export type DocsSessionRevoked = z.infer<typeof docsSessionRevokedSchema>;

/** The site that asked is not one this deployment lets connect; no key is minted for it. */
export class DocsOriginNotRegisteredError extends HandledError {
  declare readonly code: "docs_origin_not_registered";

  constructor() {
    super(
      "docs_origin_not_registered",
      "This site is not registered to connect to LangWatch, so no key was created for it",
      { httpStatus: 403, fault: "customer", ...remediation("docs_origin_not_registered") },
    );
    this.name = "DocsOriginNotRegisteredError";
  }
}
