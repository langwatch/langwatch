// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The SCIM tokens management REST family, at `/api/scim-tokens`.
 *
 * A SCIM token is the credential an identity provider will hold, so it is
 * shown exactly once, in the create response; listing describes tokens (id,
 * description, timestamps) and never returns a value or a hash. Revocation is
 * immediate and idempotent: an id that does not exist in the caller's
 * organization (including one already revoked) answers 404
 * `scim_token_not_found`, which a provisioning tool treats as already done.
 *
 * It answers from the same application the settings page reaches over tRPC, so
 * the two doors cannot drift on what minting a token means. The organization
 * is the one the credential resolved rather than one the caller names: an
 * organization key names its own tenant, and a body that could name another
 * would be a claim nothing checks.
 */
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import { ScimApi } from "@langwatch/enterprise-scim-contract";
import { z } from "zod";

/**
 * Who a mint or a revocation is recorded against: the member the credential
 * acts as, or the credential itself where it acts as nobody. A bound fact,
 * because who a management key stands for is the door's answer and not a
 * claim the body can make.
 */
export const scimTokenRestActor = defineRestMiddleware(
  "scimTokenRestActor",
  z.object({ actorId: z.string() }),
);

const tokenSummarySchema = z.object({
  id: z.string(),
  description: z.string().nullable(),
  /** D08: which single sign-on connection this token reaches. An id, never a
   *  secret — and the most important thing about a token, so it is listed. */
  connectionId: z.string().nullable(),
  createdAt: z.date(),
  lastUsedAt: z.date().nullable(),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

const createTokenSchema = z.object({
  description: z.string().trim().min(1).max(255).optional(),
  /** D08: the connection this token is for, and the whole of its write
   *  authority. Optional on the wire and required by the application, so a
   *  provisioning tool that has not been updated gets the named
   *  `scim_connection_required` refusal rather than a schema error. */
  connectionId: z.string().trim().min(1).optional(),
});

export const scimTokenRest = defineRestRouter(ScimApi)
  .withNamespace("scim-tokens")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("organization")

  .get("/", "listScimTokens")
  .withPermission("organization:manage")
  .withOutput(z.object({ tokens: z.array(tokenSummarySchema) }))
  .withDocs({
    tags: ["SCIM Tokens"],
    description:
      "List the organization's SCIM bearer tokens: id, description, creation time and last use. Token values and hashes are never returned; the value exists only in the create response, once.",
  })
  .handle(async ({ app, scope }) => ({
    tokens: await app.listTokens({ organizationId: scope.id }),
  }))

  .post("/", "createScimToken")
  .withInput(createTokenSchema)
  .withPermission("organization:manage")
  .withOutput(
    z.object({
      id: z.string(),
      token: z.string(),
      // Declared because the handler returns it and the framework validates the
      // answer against this schema: undeclared, the one field naming what the
      // token can reach was dropped on the way out.
      connectionId: z.string().nullable(),
      description: z.string().nullable(),
    }),
  )
  .withStatus(201)
  .withDocs({
    tags: ["SCIM Tokens"],
    description:
      "Mint a SCIM bearer token for this organization's /api/scim/v2 endpoints. The token value is returned once, here, and never again; store it in the identity provider immediately.",
  })
  .withMiddleware(scimTokenRestActor)
  .handle(async ({ app, input, scope }, actor) => {
    const created = await app.generateToken({
      organizationId: scope.id,
      // The connection is the token's whole write authority, and the
      // application refuses without one. Dropping it here made every REST
      // create answer `scim_connection_required` no matter what the caller
      // sent, while the tRPC door passed it and worked.
      connectionId: input.connectionId,
      description: input.description,
    });

    app.recordTokenAudit({
      organizationId: scope.id,
      actorId: actor.actorId,
      action: "management.scimToken.create",
      args: { tokenId: created.tokenId, connectionId: created.connectionId },
    });

    return {
      id: created.tokenId,
      token: created.token,
      connectionId: created.connectionId,
      description: input.description ?? null,
    };
  })

  .delete("/:id", "revokeScimToken")
  .withParams(idParamsSchema)
  .withPermission("organization:manage")
  .withOutput(z.object({ success: z.literal(true) }))
  .withDocs({
    tags: ["SCIM Tokens"],
    description:
      "Revoke a SCIM token so it stops verifying immediately. An unknown or already-revoked id answers 404 scim_token_not_found.",
  })
  .withMiddleware(scimTokenRestActor)
  .handle(async ({ app, input, scope }, actor) => {
    await app.revokeToken({ organizationId: scope.id, tokenId: input.id });

    app.recordTokenAudit({
      organizationId: scope.id,
      actorId: actor.actorId,
      action: "management.scimToken.delete",
      args: { tokenId: input.id },
    });

    return { success: true as const };
  })
  .build();
