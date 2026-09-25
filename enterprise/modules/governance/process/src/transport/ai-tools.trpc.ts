// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `aiTools.*`: members read under `aiTools:view`, catalogue admins
 * curate under `aiTools:manage`, and every write is attributed to the caller, as on main.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { aiToolsTrpc, GovernanceRestApi } from "@langwatch/enterprise-governance-contract";

export const aiToolsTrpcTransport = defineTrpcRouter(GovernanceRestApi, aiToolsTrpc)
  .procedure("list")
  .withPermission("aiTools:view")
  .handle(({ app, input, actor }) =>
    app.aiToolListForUser({ organizationId: input.organizationId, userId: actor.id }),
  )

  .procedure("providerAvailability")
  .withPermission("aiTools:view")
  .handle(({ app, input, actor }) =>
    app.aiToolProviderAvailability({ organizationId: input.organizationId, userId: actor.id }),
  )

  .procedure("claudeCodeOtlpEndpoint")
  .withPermission("aiTools:view")
  .handle(({ app, input }) => app.aiToolClaudeCodeOtlpEndpoint(input))

  .procedure("adminList")
  .withPermission("aiTools:manage")
  .handle(({ app, input }) => app.aiToolListForAdmin(input))

  .procedure("get")
  .withPermission("aiTools:manage")
  .handle(({ app, input }) => app.aiToolGetById(input))

  .procedure("create")
  .withPermission("aiTools:manage")
  .handle(({ app, input, actor }) => app.aiToolCreate({ ...input, actorUserId: actor.id }))

  .procedure("update")
  .withPermission("aiTools:manage")
  .handle(({ app, input, actor }) => app.aiToolUpdate({ ...input, actorUserId: actor.id }))

  .procedure("remove")
  .withPermission("aiTools:manage")
  .handle(({ app, input }) => app.aiToolRemove(input))

  .procedure("setEnabled")
  .withPermission("aiTools:manage")
  .handle(({ app, input, actor }) => app.aiToolUpdate({ ...input, actorUserId: actor.id }))

  .procedure("importStarterPack")
  .withPermission("aiTools:manage")
  .handle(({ app, input, actor }) => app.aiToolSeedStarterPack({ ...input, actorUserId: actor.id }))

  .procedure("starterPackCatalog")
  .withPermission("aiTools:manage")
  .handle(({ app }) => app.aiToolStarterPackCatalog())

  .procedure("providerOptions")
  .withPermission("aiTools:manage")
  .handle(({ app, input }) => app.aiToolListProviderOptionsForAdmin(input))

  .procedure("routingPolicyOptions")
  .withPermission("aiTools:manage")
  .handle(({ app, input }) => app.aiToolListRoutingPolicyOptionsForAdmin(input))

  .procedure("reorder")
  .withPermission("aiTools:manage")
  .handle(async ({ app, input }) => {
    await app.aiToolReorder(input);
    return { ok: true };
  })
  .build();
