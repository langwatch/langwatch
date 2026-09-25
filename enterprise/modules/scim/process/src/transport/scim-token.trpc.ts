// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `scimToken.*`: the settings page's door onto the same
 * application the management REST family reaches.
 *
 * Minting and revoking a directory token takes `sso:manage` (ADR-122): a token
 * is the whole write authority a directory holds over an organization's
 * membership. Reading the list, and the connections a token can be minted
 * against, is seeing rather than managing, so both take `sso:view`.
 *
 * The Enterprise plan gate is NOT declared here, and it is not gone: it ran
 * SECOND, after the permission check, so that a caller who does not belong to
 * the organization is told that rather than told what the organization has not
 * bought. Neither runtime has a seam for a gate that is not an RBAC
 * permission, so the process applies it at the mount, over
 * `ScimApi.isEnterpriseEntitled`.
 *
 * @see enterprise/modules/scim/specs/scim.feature
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { ScimApi, scimTokenTrpc } from "@langwatch/enterprise-scim-contract";

export const scimTokenTrpcTransport = defineTrpcRouter(ScimApi, scimTokenTrpc)
  .procedure("list")
  .withPermission("sso:view")
  .handle(({ app, input }) => app.listTokens({ organizationId: input.organizationId }))

  .procedure("connections")
  .withPermission("sso:view")
  .handle(({ app, input }) => app.findConnections({ organizationId: input.organizationId }))

  .procedure("generate")
  .withPermission("sso:manage")
  .handle(({ app, input }) =>
    app.generateToken({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      description: input.description,
      secret: input.secret,
    }),
  )

  .procedure("revoke")
  .withPermission("sso:manage")
  .handle(({ app, input }) =>
    app.revokeToken({ organizationId: input.organizationId, tokenId: input.tokenId }),
  )
  .build();
