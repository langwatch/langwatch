/** The server half of `gatewayA2aTargets.*`; gateways read targets through the config bundle. */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { GatewayApi, gatewayA2aTargetTrpc } from "@langwatch/gateway-contract";

import { a2aTargetToDto } from "../rules/gateway-a2a-target.rules.ts";

export const gatewayA2aTargetTrpcTransport: TrpcRouterDeclaration<
  GatewayApi,
  typeof gatewayA2aTargetTrpc
> = defineTrpcRouter(GatewayApi, gatewayA2aTargetTrpc)
  .procedure("list")
  .withPermission("virtualKeys:view")
  .handle(async ({ app, input }) => {
    await app.assertOrganizationExists(input.organizationId);
    return (await app.listA2aTargets(input.organizationId)).map(a2aTargetToDto);
  })

  .procedure("create")
  .withPermission("virtualKeys:manage")
  .handle(async ({ app, input, actor }) => {
    await app.assertOrganizationExists(input.organizationId);
    return a2aTargetToDto(await app.createA2aTarget({ ...input, actorUserId: actor.id }));
  })

  .procedure("update")
  .withPermission("virtualKeys:manage")
  .handle(async ({ app, input, actor }) => {
    await app.assertOrganizationExists(input.organizationId);
    return a2aTargetToDto(await app.updateA2aTarget({ ...input, actorUserId: actor.id }));
  })

  .procedure("setBlocked")
  .withPermission("virtualKeys:manage")
  .handle(async ({ app, input, actor }) => {
    await app.assertOrganizationExists(input.organizationId);
    return a2aTargetToDto(await app.setA2aTargetBlocked({ ...input, actorUserId: actor.id }));
  })

  .procedure("delete")
  .withPermission("virtualKeys:manage")
  .handle(async ({ app, input }) => {
    await app.assertOrganizationExists(input.organizationId);
    return a2aTargetToDto(
      await app.archiveA2aTarget({ id: input.id, organizationId: input.organizationId }),
    );
  })
  .build();
