// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `ingestionTemplates.*`: members read under `aiTools:view`,
 * admins author under `aiTools:manage`, and every write is attributed to the caller, as on main.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import {
  GovernanceRestApi,
  ingestionTemplatesTrpc,
} from "@langwatch/enterprise-governance-contract";

export const ingestionTemplatesTrpcTransport = defineTrpcRouter(
  GovernanceRestApi,
  ingestionTemplatesTrpc,
)
  .procedure("list")
  .withPermission("aiTools:view")
  .handle(({ app, input }) => app.templateListForUser({ organizationId: input.organizationId }))

  .procedure("adminList")
  .withPermission("aiTools:manage")
  .handle(({ app, input }) => app.templateListForOrgAdmin({ organizationId: input.organizationId }))

  .procedure("get")
  .withPermission("aiTools:view")
  .handle(({ app, input }) => app.templateGetByIdForOrg(input))

  .procedure("create")
  .withPermission("aiTools:manage")
  .handle(({ app, input, actor }) => app.templateCreateOrg({ ...input, callerUserId: actor.id }))

  .procedure("updateOttlRules")
  .withPermission("aiTools:manage")
  .handle(({ app, input, actor }) =>
    app.templateUpdateOttlRules({ ...input, callerUserId: actor.id }),
  )

  .procedure("archive")
  .withPermission("aiTools:manage")
  .handle(async ({ app, input, actor }) => {
    await app.templateArchiveOrg({ ...input, callerUserId: actor.id });
    return { ok: true };
  })

  .procedure("cloneFromPlatform")
  .withPermission("aiTools:manage")
  .handle(({ app, input, actor }) =>
    app.templateCloneFromPlatform({ ...input, callerUserId: actor.id }),
  )
  .build();
