/**
 * The SCIM tokens management REST family.
 *
 * A SCIM token is the credential an identity provider will hold, so it is
 * shown exactly once, in the create response; listing describes tokens (id,
 * description, timestamps) and never returns a value or a hash. Revocation is
 * immediate and idempotent: an id that does not exist in the caller's
 * organization (including one already revoked) answers 404
 * `scim_token_not_found`, which a provisioning tool treats as already done.
 */

import { ScimTokenService } from "@ee/scim/scim-token.service";
import type { EndpointVariables, ServiceContext } from "@langwatch/api";
import type { Context } from "hono";
import { z } from "zod";
import type { Organization } from "~/generated/prisma/client";
import { emitManagementAudit } from "~/server/api/management/audit";
import { createManagementService } from "~/server/api/management/managed-service";
import { MANAGEMENT_API_VERSION } from "~/server/api/management/version";
import { prisma } from "~/server/db";

const { service, guard } = createManagementService({
  name: "scim-tokens",
  basePath: "/api/scim-tokens",
  feature: "SCIM",
});

/** The handler context: the framework's variables plus the family's provider. */
type ScimTokensContext = ServiceContext<
  EndpointVariables & { scimTokens: ScimTokenService }
>;

const tokenSummarySchema = z.object({
  id: z.string(),
  description: z.string().nullable(),
  createdAt: z.date(),
  lastUsedAt: z.date().nullable(),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

const createTokenSchema = z.object({
  description: z.string().trim().min(1).max(255).optional(),
});

const organizationOf = (c: Context): Organization =>
  c.get("organization") as Organization;

// ── handlers ─────────────────────────────────────────────────────────────────

const listTokensHandler = async (c: ScimTokensContext) => {
  const tokens = await c.get("scimTokens").list({
    organizationId: organizationOf(c).id,
  });
  return { tokens };
};

const createTokenHandler = async (
  c: ScimTokensContext,
  input: z.infer<typeof createTokenSchema>,
) => {
  const organization = organizationOf(c);
  const created = await c.get("scimTokens").generate({
    organizationId: organization.id,
    ...(input.description !== undefined
      ? { description: input.description }
      : {}),
  });
  emitManagementAudit({
    c,
    organizationId: organization.id,
    action: "management.scimToken.create",
    args: { tokenId: created.tokenId },
  });
  return {
    id: created.tokenId,
    token: created.token,
    description: input.description ?? null,
  };
};

const revokeTokenHandler = async (c: ScimTokensContext) => {
  const params = c.get("params") as z.infer<typeof idParamsSchema>;
  const organization = organizationOf(c);
  await c.get("scimTokens").revoke({
    organizationId: organization.id,
    tokenId: params.id,
  });
  emitManagementAudit({
    c,
    organizationId: organization.id,
    action: "management.scimToken.delete",
    args: { tokenId: params.id },
  });
  return { success: true as const };
};

// ── service wiring ───────────────────────────────────────────────────────────

export const app = service
  .provide({
    scimTokens: () => ScimTokenService.create(prisma),
  })
  .registerRoute("get", "/", MANAGEMENT_API_VERSION, listTokensHandler, (b) =>
    guard("organization:manage")(b)
      .withOutput(z.object({ tokens: z.array(tokenSummarySchema) }))
      .withDocs({
        operationId: "listScimTokens",
        tags: ["SCIM Tokens"],
        description:
          "List the organization's SCIM bearer tokens: id, description, creation time and last use. Token values and hashes are never returned; the value exists only in the create response, once.",
      }),
  )
  .registerRoute(
    "post",
    "/",
    MANAGEMENT_API_VERSION,
    createTokenHandler,
    (b) =>
      guard("organization:manage")(b)
        .withInput(createTokenSchema)
        .withOutput(
          z.object({
            id: z.string(),
            token: z.string(),
            description: z.string().nullable(),
          }),
        )
        .withStatus(201)
        .withDocs({
          operationId: "createScimToken",
          tags: ["SCIM Tokens"],
          description:
            "Mint a SCIM bearer token for this organization's /api/scim/v2 endpoints. The token value is returned once, here, and never again; store it in the identity provider immediately.",
        }),
  )
  .registerRoute(
    "delete",
    "/:id",
    MANAGEMENT_API_VERSION,
    revokeTokenHandler,
    (b) =>
      guard("organization:manage")(b)
        .withParams(idParamsSchema)
        .withOutput(z.object({ success: z.literal(true) }))
        .withDocs({
          operationId: "revokeScimToken",
          tags: ["SCIM Tokens"],
          description:
            "Revoke a SCIM token so it stops verifying immediately. An unknown or already-revoked id answers 404 scim_token_not_found.",
        }),
  )
  .build();
