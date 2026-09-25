// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `ingestionSources.*`: reads under `ingestionSources:view`, writes under
 * `ingestionSources:manage`, and a create is attributed to the caller, as on main.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { GovernanceRestApi, ingestionSourcesTrpc } from "@langwatch/enterprise-governance-contract";

export const ingestionSourcesTrpcTransport = defineTrpcRouter(
  GovernanceRestApi,
  ingestionSourcesTrpc,
)
  .procedure("list")
  .withPermission("ingestionSources:view")
  .handle(({ app, input }) => app.ingestionSourceList(input))

  .procedure("get")
  .withPermission("ingestionSources:view")
  .handle(({ app, input }) => app.ingestionSourceGet(input))

  .procedure("create")
  .withPermission("ingestionSources:manage")
  .handle(({ app, input, actor }) => app.ingestionSourceCreate({ ...input, actorUserId: actor.id }))

  .procedure("update")
  .withPermission("ingestionSources:manage")
  .handle(({ app, input }) => app.ingestionSourceUpdate(input))

  .procedure("rotateSecret")
  .withPermission("ingestionSources:manage")
  .handle(({ app, input }) => app.ingestionSourceRotateSecret(input))

  .procedure("archive")
  .withPermission("ingestionSources:manage")
  .handle(({ app, input }) => app.ingestionSourceArchive(input))

  .procedure("validateOttl")
  .withPermission("ingestionSources:manage")
  .handle(({ app, input }) => app.ingestionSourceValidateOttl(input))

  .procedure("ottlStarter")
  .withPermission("ingestionSources:view")
  .handle(({ app, input }) => app.ingestionSourceOttlStarter(input))
  .build();
