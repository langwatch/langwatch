// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `ingestionKey.*`: the caller's own personal ingestion
 * keys, gated on `organization:view` (membership), as on main.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { GovernanceRestApi, ingestionKeyTrpc } from "@langwatch/enterprise-governance-contract";

export const ingestionKeyTrpcTransport: TrpcRouterDeclaration<
  GovernanceRestApi,
  typeof ingestionKeyTrpc
> = defineTrpcRouter(GovernanceRestApi, ingestionKeyTrpc)
  .procedure("list")
  .withPermission("organization:view")
  .handle(({ app, input, actor }) =>
    app.ingestionKeyList({ organizationId: input.organizationId, userId: actor.id }),
  )

  .procedure("install")
  .mintsCredential("organization:view")
  .withPermission("organization:view")
  .handle(({ app, input, actor }) =>
    app.ingestionKeyInstall({
      userId: actor.id,
      impersonatorId: actor.impersonatorId,
      organizationId: input.organizationId,
      sourceType: input.sourceType,
      ingestionTemplateId: input.templateId ?? null,
      surface: "trpc",
    }),
  )

  .procedure("rotate")
  .mintsCredential("organization:view")
  .withPermission("organization:view")
  .handle(({ app, input, actor }) =>
    app.ingestionKeyRotate({
      userId: actor.id,
      impersonatorId: actor.impersonatorId,
      organizationId: input.organizationId,
      sourceType: input.sourceType,
      ingestionTemplateId: input.templateId ?? null,
      surface: "trpc",
    }),
  )

  .procedure("revoke")
  .withPermission("organization:view")
  .handle(async ({ app, input, actor }) => {
    await app.ingestionKeyRevoke({ ...input, userId: actor.id, surface: "trpc" });
    return { success: true };
  })
  .build();
