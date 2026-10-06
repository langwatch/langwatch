/**
 * The server half of the group-queue and dead-letter procedures. Platform-tier
 * throughout: the door asks `ops:view` or `ops:manage` of the operator's platform grant.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { OpsApi, opsQueueTrpc } from "@langwatch/ops-contract";

export const opsQueueTrpcTransport: TrpcRouterDeclaration<OpsApi, typeof opsQueueTrpc> =
  defineTrpcRouter(OpsApi, opsQueueTrpc)
    .procedure("listGroups")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.listQueueGroups(input))

    .procedure("getGroupDetail")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.getQueueGroup(input))

    .procedure("getGrafanaLinkConfig")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app }) => app.findGrafanaLinkConfig())

    .procedure("getBlockedSummary")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app }) => app.getBlockedQueueSummary())

    .procedure("getGroupJobs")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.listQueueGroupJobs(input))

    .procedure("unblockGroup")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input, actor }) => app.unblockQueueGroup({ ...input, requestedBy: actor.id }))

    .procedure("unblockAll")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input, actor }) =>
      app.unblockAllQueueGroups({ ...input, requestedBy: actor.id }),
    )

    .procedure("drainGroup")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input, actor }) => app.drainQueueGroup({ ...input, requestedBy: actor.id }))

    .procedure("pausePipeline")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input }) => app.pauseQueuePipeline(input))

    .procedure("unpausePipeline")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input }) => app.unpauseQueuePipeline(input))

    .procedure("pauseTenant")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input }) => app.pauseQueueTenant(input))

    .procedure("unpauseTenant")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input }) => app.unpauseQueueTenant(input))

    .procedure("listPausedTenants")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.listPausedQueueTenants(input))

    .procedure("drainTenant")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input, actor }) => app.drainQueueTenant({ ...input, requestedBy: actor.id }))

    .procedure("retryBlocked")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input }) => app.retryBlockedQueueJob(input))

    .procedure("listProjections")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app }) => app.listPipelineRegistrations())

    .procedure("listDlqGroups")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.listQueueDlqGroups(input))

    .procedure("listAllDlqGroups")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app }) => app.listAllQueueDlqGroups())

    .procedure("listPausedKeys")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.listPausedQueueKeys(input))

    .procedure("drainAllBlockedPreview")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.getQueueDrainPreview(input))

    .procedure("moveToDlq")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input, actor }) => app.moveQueueGroupToDlq({ ...input, requestedBy: actor.id }))

    .procedure("moveAllBlockedToDlq")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input, actor }) =>
      app.moveAllBlockedQueueGroupsToDlq({ ...input, requestedBy: actor.id }),
    )

    .procedure("replayFromDlq")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input }) => app.replayQueueGroupFromDlq(input))

    .procedure("replayAllFromDlq")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input }) => app.replayAllQueueGroupsFromDlq(input))

    .procedure("redriveManyFromDlq")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input, actor }) =>
      app.redriveQueueDlqGroups({ ...input, requestedBy: actor.id }),
    )

    .procedure("discardManyFromDlq")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input, actor }) =>
      app.discardQueueDlqGroups({ ...input, requestedBy: actor.id }),
    )

    .procedure("canaryRedrive")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input }) => app.canaryRedriveQueueDlq(input))

    .procedure("canaryUnblock")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input }) => app.canaryUnblockQueueGroups(input))

    .build();
