// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `scimToken.*`: the settings page's door onto the same
 * application the management REST family reaches.
 *
 * Every procedure takes `organization:manage`: a SCIM token writes members
 * into the organization, so minting one is the same authority as inviting
 * anybody.
 *
 * The Enterprise plan gate is NOT declared here, and it is not gone: it ran
 * SECOND, after the permission check, so that a caller who does not belong to
 * the organization is told that rather than told what the organization has not
 * bought. Neither runtime has a seam for a gate that is not an RBAC
 * permission, so the process applies it at the mount, over
 * `ScimApi.isEnterpriseEntitled`.
 *
 * @see packages/enterprise/features/scim/specs/scim.feature
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { ScimApi, scimTokenTrpc } from "@langwatch/enterprise-scim-contract";

export const scimTokenTrpcTransport = defineTrpcRouter(ScimApi, scimTokenTrpc)
  .procedure("list")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.listTokens({ organizationId: input.organizationId }))

  .procedure("generate")
  .withPermission("organization:manage")
  .handle(({ app, input }) =>
    app.generateToken({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      description: input.description,
    }),
  )

  .procedure("revoke")
  .withPermission("organization:manage")
  .handle(({ app, input }) =>
    app.revokeToken({ organizationId: input.organizationId, tokenId: input.tokenId }),
  )
  .build();
