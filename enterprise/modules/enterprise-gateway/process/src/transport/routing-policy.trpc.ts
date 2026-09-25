// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The server half of `routingPolicy.*`: `routingPolicies:view` reads, `routingPolicies:manage` writes, as on main. */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { EnterpriseGatewayApi, routingPolicyTrpc } from "@langwatch/enterprise-gateway-contract";

export const routingPolicyTrpcTransport = defineTrpcRouter(EnterpriseGatewayApi, routingPolicyTrpc)
  .procedure("list")
  .withPermission("routingPolicies:view")
  .handle(({ app, input }) => app.listRoutingPolicies(input))

  .procedure("get")
  .withPermission("routingPolicies:view")
  .handle(({ app, input }) => app.getRoutingPolicy(input))

  .procedure("tierSuggestions")
  .withPermission("routingPolicies:view")
  .handle(({ app, input }) =>
    app.routingPolicyTierSuggestions({
      tier: input.tier,
      boundProviderTypes: input.boundProviderTypes,
    }),
  )

  .procedure("create")
  .withPermission("routingPolicies:manage")
  .handle(({ app, input, actor }) => app.createRoutingPolicy({ ...input, actorUserId: actor.id }))

  .procedure("update")
  .withPermission("routingPolicies:manage")
  .handle(({ app, input, actor }) => app.updateRoutingPolicy({ ...input, actorUserId: actor.id }))

  .procedure("setDefault")
  .withPermission("routingPolicies:manage")
  .handle(({ app, input, actor }) =>
    app.setDefaultRoutingPolicy({ ...input, actorUserId: actor.id }),
  )

  .procedure("delete")
  .withPermission("routingPolicies:manage")
  .handle(async ({ app, input }) => {
    await app.deleteRoutingPolicy(input);
    return { ok: true };
  })
  .build();
