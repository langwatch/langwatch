// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

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

import type { EndpointVariables, ServiceContext } from "@langwatch/api/rest";
import type { ScimService } from "@langwatch/enterprise-scim-contract";
import type { Organization } from "@langwatch/prisma-client/generated";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";

import {
  type AppRestManagementAuditPort,
  type AppRestSecurity,
  emitManagementAudit,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
} from "../../app-rest";

/** The handler context: the framework's variables plus the family's provider. */
type ScimTokensContext = ServiceContext<EndpointVariables & { scim: ScimService }>;

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

const organizationOf = (c: Context): Organization => c.get("organization") as Organization;

/**
 * REST for the organization's SCIM bearer tokens.
 *
 * The SCIM capability arrives as a provider rather than being read off the
 * request, so this family can be mounted into any process that has one.
 */
export function createScimTokensRestApp(options: {
  security: AppRestSecurity;
  /**
   * The Enterprise plan gate for this family's capability, applied after
   * authentication and after the RBAC check on every route it declares.
   *
   * A plain middleware the mount supplies, not a feature of the builder: the
   * REST service neither knows nor names Enterprise, and "you don't have
   * access" still beats "your plan doesn't include this".
   */
  enterpriseGate: MiddlewareHandler;
  /**
   * Resolved per request, as reading it off the Hono context used to be:
   * mounting a family must not force its services to be constructed, which is
   * what lets the OpenAPI spec generator build this app with none.
   */
  scim: () => ScimService;
  audit: AppRestManagementAuditPort;
}): MountableRestApp {
  const { security, enterpriseGate, scim, audit } = options;

  const { service, policy } = security.createVersionedApp({
    name: "scim-tokens",
    basePath: "/api/scim-tokens",
    routeMiddleware: [enterpriseGate],
  });

  // ── handlers ───────────────────────────────────────────────────────────────

  const listTokensHandler = async (c: ScimTokensContext) => {
    const tokens = await c.get("scim").listTokens({
      organizationId: organizationOf(c).id,
    });
    return { tokens };
  };

  const createTokenHandler = async (
    c: ScimTokensContext,
    input: z.infer<typeof createTokenSchema>,
  ) => {
    const organization = organizationOf(c);
    const created = await c.get("scim").generateToken({
      organizationId: organization.id,
      ...(input.description !== undefined ? { description: input.description } : {}),
    });
    emitManagementAudit({
      c,
      audit,
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
    c: ScimTokensContext,
    input: z.infer<typeof idParamsSchema>,
  ) => {
    const organization = organizationOf(c);
    await c.get("scim").revokeToken({
      organizationId: organization.id,
      tokenId: input.id,
    });
    emitManagementAudit({
      c,
      audit,
      organizationId: organization.id,
      action: "management.scimToken.delete",
      args: { tokenId: input.id },
    });
    return { success: true as const };
  };

  // ── service wiring ─────────────────────────────────────────────────────────

  return service
    .provide({ scim: () => scim() })
    .registerRoute("get", "/", MANAGEMENT_API_VERSION, listTokensHandler, (b) =>
      policy("organization:manage")(b)
        .withOutput(z.object({ tokens: z.array(tokenSummarySchema) }))
        .withDocs({
          operationId: "listScimTokens",
          tags: ["SCIM Tokens"],
          description:
            "List the organization's SCIM bearer tokens: id, description, creation time and last use. Token values and hashes are never returned; the value exists only in the create response, once.",
        }),
    )
    .registerRoute("post", "/", MANAGEMENT_API_VERSION, createTokenHandler, (b) =>
      policy("organization:manage")(b)
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
    .registerRoute("delete", "/:id", MANAGEMENT_API_VERSION, revokeTokenHandler, (b) =>
      policy("organization:manage")(b)
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
}
