/** The server half of `gatewayA2aTargets.*`; gateways read targets through the config bundle. */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { GatewayApi, gatewayA2aTargetTrpc } from "@langwatch/gateway-contract";

export const gatewayA2aTargetTrpcTransport: TrpcRouterDeclaration<
  GatewayApi,
  typeof gatewayA2aTargetTrpc
> = defineTrpcRouter(GatewayApi, gatewayA2aTargetTrpc)
  .procedure("list")
  .withPermission("virtualKeys:view")
  .handle(({ app, input }) => {
    return app.listA2aTargets(input.organizationId);
  })

  .procedure("create")
  // A project-scoped row names the project's organization; an org-wide one derives its target.
  .withAudit({ target: "organization", via: "projectId" })
  .withPermission("virtualKeys:manage")
  .handle(({ app, input, actor }) => {
    return app.createA2aTarget({ ...input, actorUserId: actor.id });
  })

  .procedure("update")
  .withPermission("virtualKeys:manage")
  .handle(({ app, input, actor }) => {
    return app.updateA2aTarget({ ...input, actorUserId: actor.id });
  })

  .procedure("setBlocked")
  .withPermission("virtualKeys:manage")
  .handle(({ app, input, actor }) => {
    return app.setA2aTargetBlocked({ ...input, actorUserId: actor.id });
  })

  .procedure("delete")
  .withPermission("virtualKeys:manage")
  .handle(({ app, input }) => {
    return app.archiveA2aTarget({ id: input.id, organizationId: input.organizationId });
  })

  .procedure("listForProject")
  .withPermission("virtualKeys:view", { via: "projectId" })
  .handle(({ app, input }) => {
    return app.listProjectA2aTargets({ projectId: input.projectId });
  })

  .procedure("updateForProject")
  .withPermission("virtualKeys:manage", { via: "projectId" })
  .handle(({ app, input, actor }) => {
    return app.updateProjectA2aTarget({ ...input, actorUserId: actor.id });
  })

  .procedure("setBlockedForProject")
  .withPermission("virtualKeys:manage", { via: "projectId" })
  .handle(({ app, input, actor }) => {
    return app.setProjectA2aTargetBlocked({ ...input, actorUserId: actor.id });
  })

  .procedure("deleteForProject")
  .withPermission("virtualKeys:manage", { via: "projectId" })
  .handle(({ app, input }) => {
    return app.archiveProjectA2aTarget({ id: input.id, projectId: input.projectId });
  })
  .build();
