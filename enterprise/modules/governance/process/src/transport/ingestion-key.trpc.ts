// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `ingestionKey.*`: the caller's own personal ingestion
 * keys, gated on `organization:view` (membership), as on main.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { GovernanceRestApi, ingestionKeyTrpc } from "@langwatch/enterprise-governance-contract";

export const ingestionKeyTrpcTransport = defineTrpcRouter(GovernanceRestApi, ingestionKeyTrpc)
  .procedure("list")
  .withPermission("organization:view")
  .handle(({ app, input, actor }) =>
    app.ingestionKeyList({ organizationId: input.organizationId, userId: actor.id }),
  )

  .procedure("install")
  .withPermission("organization:view")
  .handle(({ app, input, actor }) =>
    app.ingestionKeyInstall({
      userId: actor.id,
      organizationId: input.organizationId,
      sourceType: input.sourceType,
      ingestionTemplateId: input.templateId ?? null,
    }),
  )

  .procedure("rotate")
  .withPermission("organization:view")
  .handle(({ app, input, actor }) =>
    app.ingestionKeyRotate({
      userId: actor.id,
      organizationId: input.organizationId,
      sourceType: input.sourceType,
      ingestionTemplateId: input.templateId ?? null,
    }),
  )

  .procedure("revoke")
  .withPermission("organization:view")
  .handle(async ({ app, input, actor }) => {
    await app.ingestionKeyRevoke({ ...input, userId: actor.id });
    return { success: true };
  })
  .build();
