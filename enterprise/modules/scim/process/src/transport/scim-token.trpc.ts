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
 * The Enterprise plan gate is declared on list, generate and revoke, as main
 * asked it; the framework asks it after access, so a caller who may not do
 * this is told that rather than told what the organization has not bought.
 *
 * @see enterprise/modules/scim/specs/scim.feature
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { ScimApi, scimTokenTrpc } from "@langwatch/enterprise-scim-contract";

export const scimTokenTrpcTransport: TrpcRouterDeclaration<ScimApi, typeof scimTokenTrpc> =
  defineTrpcRouter(ScimApi, scimTokenTrpc)
    .procedure("list")
    .withEntitlement("enterprise", { feature: "SCIM" })
    .withPermission("sso:view")
    .handle(({ app, input }) => app.listTokens({ organizationId: input.organizationId }))

    .procedure("connections")
    .withPermission("sso:view")
    .handle(({ app, input }) => app.findConnections({ organizationId: input.organizationId }))

    .procedure("generate")
    .mintsCredential("sso:manage")
    .withEntitlement("enterprise", { feature: "SCIM" })
    .withPermission("sso:manage")
    .handle(({ app, input, actor }) =>
      app.generateToken(
        {
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          description: input.description,
          secret: input.secret,
        },
        // Only a full organization admin may mint: the token hands on directory group grants.
        { id: actor.id, impersonatorId: actor.impersonatorId },
      ),
    )

    .procedure("revoke")
    .withEntitlement("enterprise", { feature: "SCIM" })
    .withPermission("sso:manage")
    .handle(({ app, input }) =>
      app.revokeToken({ organizationId: input.organizationId, tokenId: input.tokenId }),
    )
    .build();
