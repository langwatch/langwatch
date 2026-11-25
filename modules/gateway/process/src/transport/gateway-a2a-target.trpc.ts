/** The server half of `gatewayA2aTargets.*`; gateways read targets through the config bundle. */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { GatewayApi, gatewayA2aTargetTrpc } from "@langwatch/gateway-contract";

export const gatewayA2aTargetTrpcTransport: TrpcRouterDeclaration<
  GatewayApi,
  typeof gatewayA2aTargetTrpc
> = defineTrpcRouter(GatewayApi, gatewayA2aTargetTrpc)
  .procedure("list")
  .withPermission("gatewayA2aTargets:view")
  .handle(({ app, input }) => {
    return app.listA2aTargets(input.organizationId);
  })

  .procedure("create")
  // A project-scoped row names the project's organization; an org-wide one derives its target.
  .withAudit({ target: "organization", via: "projectId" })
  .withPermission("gatewayA2aTargets:manage")
  .handle(({ app, input, actor }) => {
    return app.createA2aTarget({ ...input, actorUserId: actor.id });
  })

  .procedure("update")
  .withPermission("gatewayA2aTargets:manage")
  .handle(({ app, input, actor }) => {
    return app.updateA2aTarget({ ...input, actorUserId: actor.id });
  })

  .procedure("setBlocked")
  .withPermission("gatewayA2aTargets:manage")
  .handle(({ app, input, actor }) => {
    return app.setA2aTargetBlocked({ ...input, actorUserId: actor.id });
  })

  .procedure("archive")
  .withPermission("gatewayA2aTargets:manage")
  .handle(({ app, input, actor }) => {
    return app.archiveA2aTarget({
      id: input.id,
      organizationId: input.organizationId,
      actorUserId: actor.id,
    });
  })

  .procedure("listForProject")
  .withPermission("gatewayA2aTargets:view", { via: "projectId" })
  .handle(({ app, input }) => {
    return app.listProjectA2aTargets({ projectId: input.projectId });
  })

  .procedure("updateForProject")
  .withPermission("gatewayA2aTargets:manage", { via: "projectId" })
  .handle(({ app, input, actor }) => {
    return app.updateProjectA2aTarget({ ...input, actorUserId: actor.id });
  })

  .procedure("setBlockedForProject")
  .withPermission("gatewayA2aTargets:manage", { via: "projectId" })
  .handle(({ app, input, actor }) => {
    return app.setProjectA2aTargetBlocked({ ...input, actorUserId: actor.id });
  })

  .procedure("archiveForProject")
  .withPermission("gatewayA2aTargets:manage", { via: "projectId" })
  .handle(({ app, input, actor }) => {
    return app.archiveProjectA2aTarget({
      id: input.id,
      projectId: input.projectId,
      actorUserId: actor.id,
    });
  })
  .build();
