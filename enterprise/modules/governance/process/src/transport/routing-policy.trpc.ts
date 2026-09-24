// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The server half of `routingPolicy.*`: `routingPolicies:view` reads, `routingPolicies:manage` writes, as on main. */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { GovernanceRestApi, routingPolicyTrpc } from "@langwatch/enterprise-governance-contract";

export const routingPolicyTrpcTransport = defineTrpcRouter(GovernanceRestApi, routingPolicyTrpc)
  .procedure("list")
  .withPermission("routingPolicies:view")
  .handle(({ app, input }) => app.listRoutingPolicies(input))

  .procedure("get")
  .withPermission("routingPolicies:view")
  .handle(({ app, input }) => app.getRoutingPolicy(input))

  .procedure("create")
  .withPermission("routingPolicies:manage")
  .handle(({ app, input, actor }) => app.createRoutingPolicy(input, { id: actor.id }))

  .procedure("update")
  .withPermission("routingPolicies:manage")
  .handle(({ app, input, actor }) => app.updateRoutingPolicy(input, { id: actor.id }))

  .procedure("setDefault")
  .withPermission("routingPolicies:manage")
  .handle(({ app, input, actor }) => app.setDefaultRoutingPolicy(input, { id: actor.id }))

  .procedure("delete")
  .withPermission("routingPolicies:manage")
  .handle(async ({ app, input }) => {
    await app.deleteRoutingPolicy(input);
    return { ok: true };
  })
  .build();
