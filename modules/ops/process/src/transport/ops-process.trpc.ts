/**
 * The server half of the process-manager fleet procedures. Platform-tier
 * throughout: the door asks `ops:view` or `ops:manage` of the operator's platform grant.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { OpsApi, opsProcessTrpc } from "@langwatch/ops-contract";

export const opsProcessTrpcTransport: TrpcRouterDeclaration<OpsApi, typeof opsProcessTrpc> =
  defineTrpcRouter(OpsApi, opsProcessTrpc)
    .procedure("getAggregateProcessManagers")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) =>
      app.getForAggregate({
        aggregateType: input.aggregateType,
        projectId: input.tenantId,
        aggregateId: input.aggregateId,
      }),
    )

    .procedure("requeueDeadOutboxMessages")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input, actor }) =>
      app.requeueDeadMessages({
        processName: input.processName,
        projectId: input.tenantId,
        processKey: input.processKey,
        messageKeyPrefix: input.messageKeyPrefix,
        requestedBy: actor.id,
      }),
    )

    .procedure("listProcessFleet")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app }) => app.getFleetSummary())

    .procedure("listDeadLetters")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.getDeadLetters(input))

    .procedure("listDeadLetterCounts")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app }) => app.getDeadLetterCounts())

    .procedure("listProcessInstances")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.getInstances(input))

    .procedure("listUpcomingWakes")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.getUpcomingWakes(input))

    .procedure("getProcessInstance")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.findInstanceDetail({ ref: input }))

    .procedure("listProcessOutbox")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => {
      const { page, pageSize, ...ref } = input;

      return app.getOutbox({ ref, page, pageSize });
    })

    .procedure("listProcessActions")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.listRecentActions(input))

    .procedure("processWakeNow")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input, actor }) => app.wakeNow({ ref: input, actorUserId: actor.id }))

    .procedure("processRedriveDeadInstance")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input, actor }) =>
      app.redriveDeadInstance({ ref: input, actorUserId: actor.id }),
    )

    .procedure("processRedriveDeadMessage")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input, actor }) => {
      const { messageId, ...ref } = input;

      return app.redriveDeadMessage({ ref, messageId, actorUserId: actor.id });
    })

    .procedure("processDiscardDeadMessage")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input, actor }) => {
      const { messageId, ...ref } = input;

      return app.discardDeadMessage({ ref, messageId, actorUserId: actor.id });
    })

    .procedure("redriveDeadLetters")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input, actor }) => app.redriveDeadLetters({ ...input, actorUserId: actor.id }))

    .procedure("discardDeadLetters")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input, actor }) =>
      app.discardDeadLetters({
        ...(input.processName ? { processName: input.processName } : {}),
        actorUserId: actor.id,
      }),
    )

    .procedure("listOutboxAttempts")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.getOutboxAttempts(input))

    .procedure("processReleaseLapsedLease")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input, actor }) => {
      const { messageId, ...ref } = input;

      return app.releaseLapsedLease({ ref, messageId, actorUserId: actor.id });
    })

    .build();
