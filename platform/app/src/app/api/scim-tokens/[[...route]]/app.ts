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
import type { Organization } from "@prisma/client";
import type { Context } from "hono";
import { z } from "zod";
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
  createdAt: z.date(),
  lastUsedAt: z.date().nullable(),
});

const createTokenSchema = z.object({
  description: z.string().trim().min(1).max(255).optional(),
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

const revokeTokenHandler = async (
  c: Context,
  { params, app }: { params: { id: string }; app: ScimTokensFamilyApp },
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
        "List the organization's SCIM bearer tokens: id, description, creation time and last use. Token values and hashes are never returned; the value exists only in the create response, once.",
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
        description: z.string().nullable(),
      }),
      status: 201,
      description:
        "Mint a SCIM bearer token for this organization's /api/scim/v2 endpoints. The token value is returned once, here, and never again; store it in the identity provider immediately.",
      docs: { operationId: "createScimToken", tags: ["SCIM Tokens"] },
    },
    createTokenHandler,
  );

  v.delete(
    "/:id",
    {
      ...guard("organization:manage"),
      params: z.object({ id: z.string().min(1) }),
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
