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
import type { BaseApp, VersionBuilder } from "@langwatch/api";
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

type ScimTokensFamilyApp = BaseApp & { scimTokens: ScimTokenService };
type ScimTokensVersion = VersionBuilder<ScimTokensFamilyApp>;

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
   *  authority. Optional on the wire and required by the service, so a
   *  provisioning tool that has not been updated gets the named
   *  `scim_connection_required` refusal rather than a schema error. */
  connectionId: z.string().trim().min(1).optional(),
});

const organizationOf = (c: Context): Organization =>
  c.get("organization") as Organization;

// ── handlers ─────────────────────────────────────────────────────────────────

const listTokensHandler = async (
  c: Context,
  { app }: { app: ScimTokensFamilyApp },
) => {
  const tokens = await app.scimTokens.list({
    organizationId: organizationOf(c).id,
  });
  return { tokens };
};

const createTokenHandler = async (
  c: Context,
  {
    input,
    app,
  }: {
    input: z.infer<typeof createTokenSchema>;
    app: ScimTokensFamilyApp;
  },
) => {
  const organization = organizationOf(c);
  const created = await app.scimTokens.generate({
    organizationId: organization.id,
    connectionId: input.connectionId,
    ...(input.description !== undefined
      ? { description: input.description }
      : {}),
  });
  emitManagementAudit({
    c,
    organizationId: organization.id,
    action: "management.scimToken.create",
    args: { tokenId: created.tokenId, connectionId: created.connectionId },
  });
  return {
    id: created.tokenId,
    token: created.token,
    connectionId: created.connectionId,
    description: input.description ?? null,
  };
};

const revokeTokenHandler = async (
  c: Context,
  {
    params,
    app,
  }: { params: z.infer<typeof idParamsSchema>; app: ScimTokensFamilyApp },
) => {
  const organization = organizationOf(c);
  await app.scimTokens.revoke({
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

// ── endpoint registration ────────────────────────────────────────────────────

const registerEndpoints = (v: ScimTokensVersion): void => {
  v.get(
    "/",
    {
      ...guard("organization:manage"),
      output: z.object({ tokens: z.array(tokenSummarySchema) }),
      description:
        "List the organization's SCIM bearer tokens: id, description, the connection each one manages, creation time and last use. Token values and hashes are never returned; the value exists only in the create response, once.",
      docs: { operationId: "listScimTokens", tags: ["SCIM Tokens"] },
    },
    listTokensHandler,
  );

  v.post(
    "/",
    {
      ...guard("organization:manage"),
      input: createTokenSchema,
      output: z.object({
        id: z.string(),
        token: z.string(),
        connectionId: z.string(),
        description: z.string().nullable(),
      }),
      status: 201,
      description:
        "Mint a SCIM bearer token for one of this organization's single sign-on connections, for use against /api/scim/v2. The token only manages the people that connection provisioned. The token value is returned once, here, and never again; store it in the identity provider immediately.",
      docs: { operationId: "createScimToken", tags: ["SCIM Tokens"] },
    },
    createTokenHandler,
  );

  v.delete(
    "/:id",
    {
      ...guard("organization:manage"),
      params: idParamsSchema,
      output: z.object({ success: z.literal(true) }),
      description:
        "Revoke a SCIM token so it stops verifying immediately. An unknown or already-revoked id answers 404 scim_token_not_found.",
      docs: { operationId: "revokeScimToken", tags: ["SCIM Tokens"] },
    },
    revokeTokenHandler,
  );
};

// ── service wiring ───────────────────────────────────────────────────────────

export const app = service
  .provide({
    scimTokens: () => ScimTokenService.create(prisma),
  })
  .version(MANAGEMENT_API_VERSION, (v) => {
    registerEndpoints(v);
  })
  .build();
